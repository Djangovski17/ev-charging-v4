import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { logError, logInfo } from '../services/logger';

export const getStations = async (_req: Request, res: Response): Promise<void> => {
  try {
    logInfo('[Admin] Fetching all stations');
    const stations = await prisma.station.findMany({
      include: {
        connectors: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Sprawdź dla każdej stacji, czy trwa aktywna transakcja
    // i zaktualizuj status odpowiednich złączy na 'CHARGING'
    const stationsWithDynamicStatus = await Promise.all(
      stations.map(async (station) => {
        // Pobierz wszystkie aktywne transakcje dla tej stacji
        const activeTransactions = await prisma.transaction.findMany({
          where: {
            stationId: station.id,
            status: {
              in: ['PENDING', 'CHARGING'],
            },
          },
        });

        // Zaktualizuj status złączy na podstawie aktywnych transakcji
        const updatedConnectors = station.connectors.map((connector) => {
          // Sprawdź, czy istnieje aktywna transakcja dla tego konkretnego złącza
          const activeTx = activeTransactions.find(
            (tx) => tx.connectorId !== null && String(tx.connectorId) === String(connector.id)
          );

          let status = connector.status;

          // Jeśli znaleziono aktywną transakcję dla tego złącza, ustaw status na 'CHARGING'
          if (activeTx) {
            // Nie nadpisuj statusu, jeśli złącze jest w stanie FAULTED lub UNAVAILABLE
            if (connector.status !== 'FAULTED' && connector.status !== 'UNAVAILABLE') {
              status = 'CHARGING';
            }
          }

          return {
            ...connector,
            status,
          };
        });

        return {
          ...station,
          connectors: updatedConnectors,
        };
      })
    );

    res.json(stationsWithDynamicStatus);
  } catch (error) {
    logError('[Admin] Failed to fetch stations', error);
    res.status(500).json({
      error: 'Failed to fetch stations',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const createStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, name, address, city, latitude, longitude, status, connectors } = req.body;

    // Walidacja wymaganych pól stacji
    if (!id || typeof id !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'id is required and must be a string',
      });
      return;
    }

    if (!name || typeof name !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'name is required and must be a string',
      });
      return;
    }

    if (!status || typeof status !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'status is required and must be a string',
      });
      return;
    }

    // Walidacja tablicy złączy
    if (!connectors || !Array.isArray(connectors) || connectors.length === 0) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'connectors is required and must be a non-empty array',
      });
      return;
    }

    // Sprawdź czy stacja o takim ID już istnieje
    const existingStation = await prisma.station.findUnique({
      where: { id },
    });

    if (existingStation) {
      res.status(400).json({
        error: 'Station already exists',
        message: 'A station with this ID already exists',
      });
      return;
    }

    // Konwersja typów dla latitude i longitude (mogą przyjść jako string)
    let latitudeNum: number | null = null;
    let longitudeNum: number | null = null;

    if (latitude !== undefined && latitude !== null) {
      const lat = typeof latitude === 'string' ? parseFloat(latitude) : latitude;
      if (lat === null || isNaN(lat)) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'latitude must be a valid number',
        });
        return;
      }
      latitudeNum = lat;
    }

    if (longitude !== undefined && longitude !== null) {
      const lng = typeof longitude === 'string' ? parseFloat(longitude) : longitude;
      if (lng === null || isNaN(lng)) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'longitude must be a valid number',
        });
        return;
      }
      longitudeNum = lng;
    }

    // Walidacja i przygotowanie danych złączy
    const connectorsData = connectors.map((connector: any, index: number) => {
      if (!connector.type || typeof connector.type !== 'string') {
        throw new Error(`connector[${index}].type is required and must be a string`);
      }

      if (!connector.powerKw || typeof connector.powerKw !== 'number') {
        throw new Error(`connector[${index}].powerKw is required and must be a number`);
      }

      if (connector.powerKw <= 0 || !Number.isInteger(connector.powerKw)) {
        throw new Error(`connector[${index}].powerKw must be a positive integer`);
      }

      if (!connector.pricePerKwh || typeof connector.pricePerKwh !== 'number') {
        throw new Error(`connector[${index}].pricePerKwh is required and must be a number`);
      }

      if (connector.pricePerKwh <= 0) {
        throw new Error(`connector[${index}].pricePerKwh must be greater than 0`);
      }

      if (!connector.status || typeof connector.status !== 'string') {
        throw new Error(`connector[${index}].status is required and must be a string`);
      }

      return {
        type: connector.type,
        powerKw: connector.powerKw,
        pricePerKwh: connector.pricePerKwh,
        status: connector.status,
        name: connector.name ? connector.name.trim() : undefined,
      };
    });

    // Przygotowanie danych stacji
    // Uwaga: schema wymaga connectorType i pricePerKwh, więc użyjemy wartości z pierwszego złącza lub domyślnych
    const stationData: {
      id: string;
      name: string;
      status: string;
      connectorType: string;
      pricePerKwh: number;
      address?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      connectors: {
        create: Array<{
          type: string;
          powerKw: number;
          pricePerKwh: number;
          status: string;
        }>;
      };
    } = {
      id,
      name,
      status,
      connectorType: connectorsData[0]?.type || 'Type2',
      pricePerKwh: connectorsData[0]?.pricePerKwh || 2.0,
      address: address || null,
      city: city || null,
      latitude: latitudeNum,
      longitude: longitudeNum,
      connectors: {
        create: connectorsData,
      },
    };

    logInfo('[Admin] Creating new station with connectors', { 
      id, 
      name, 
      connectorsCount: connectorsData.length 
    });

    // Utworzenie stacji z złączami w jednej transakcji (nested write)
    const station = await prisma.station.create({
      data: stationData,
      include: {
        connectors: true,
      },
    });

    logInfo('[Admin] Station created successfully', { stationId: station.id });
    res.status(201).json(station);
  } catch (error) {
    logError('[Admin] Failed to create station', error);

    // Sprawdź czy to błąd walidacji złączy
    if (error instanceof Error && error.message.startsWith('connector[')) {
      res.status(400).json({
        error: 'Invalid connector data',
        message: error.message,
      });
      return;
    }

    // Sprawdź czy to błąd duplikacji ID
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(400).json({
        error: 'Station already exists',
        message: 'A station with this ID already exists',
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to create station',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const getTransactions = async (_req: Request, res: Response): Promise<void> => {
  try {
    logInfo('[Admin] Fetching all transactions');
    const transactions = await prisma.transaction.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        station: {
          select: {
            id: true,
            name: true,
            connectorType: true,
          },
        },
        connector: {
          select: {
            id: true,
            type: true,
            powerKw: true,
          },
        },
      },
    });
    res.json(transactions);
  } catch (error) {
    logError('[Admin] Failed to fetch transactions', error);
    res.status(500).json({
      error: 'Failed to fetch transactions',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const getStats = async (req: Request, res: Response): Promise<void> => {
  try {
    logInfo('[Admin] Fetching statistics');
    
    // Parsowanie parametrów query (startDate i endDate)
    let startDate: Date;
    let endDate: Date;

    if (req.query.startDate && req.query.endDate) {
      // Jeśli podano oba parametry, użyj ich
      startDate = new Date(req.query.startDate as string);
      endDate = new Date(req.query.endDate as string);
      
      // Ustaw startDate na początek dnia
      startDate.setHours(0, 0, 0, 0);
      // ZAWSZE ustaw endDate na koniec dnia (23:59:59.999)
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Domyślnie: dzisiejszy dzień
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startDate = today;
      // ZAWSZE ustaw endDate na koniec dzisiejszego dnia (23:59:59.999)
      const endOfToday = new Date(today);
      endOfToday.setHours(23, 59, 59, 999);
      endDate = endOfToday;
    }

    // Walidacja dat
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({
        error: 'Invalid date format',
        message: 'startDate and endDate must be valid ISO date strings',
      });
      return;
    }

    if (startDate > endDate) {
      res.status(400).json({
        error: 'Invalid date range',
        message: 'startDate must be before or equal to endDate',
      });
      return;
    }

    // ===== ZŁĄCZA =====
    // Total Connectors - całkowita liczba złączy w systemie
    const totalConnectors = await prisma.connector.count();

    // Pobierz wszystkie złącza
    const connectors = await prisma.connector.findMany({
      select: {
        id: true,
        status: true,
      },
    });

    // Pobierz wszystkie aktywne transakcje (PENDING lub CHARGING)
    const activeTransactions = await prisma.transaction.findMany({
      where: {
        status: {
          in: ['PENDING', 'CHARGING'],
        },
      },
      select: {
        connectorId: true,
      },
    });

    // Utwórz Set z ID złączy które mają aktywną transakcję
    const connectorsWithActiveTransactions = new Set(
      activeTransactions
        .map((tx) => tx.connectorId)
        .filter((id): id is string => id !== null)
    );

    const statusCounts = {
      available: 0,
      charging: 0,
      faulted: 0,
      total: totalConnectors,
    };

    // Policz statusy złączy
    connectors.forEach((connector) => {
      const status = connector.status.toUpperCase();
      const hasActiveTransaction = connectorsWithActiveTransactions.has(connector.id);

      // Złącze jest dostępne jeśli ma status AVAILABLE i nie ma aktywnej transakcji
      if (status === 'AVAILABLE' && !hasActiveTransaction) {
        statusCounts.available++;
      } 
      // Złącze jest zajęte (charging) jeśli ma aktywną transakcję lub status CHARGING/OCCUPIED/PENDING
      else if (hasActiveTransaction || status === 'CHARGING' || status === 'OCCUPIED' || status === 'PENDING') {
        statusCounts.charging++;
      } 
      // Złącze jest uszkodzone jeśli ma status FAULTED/UNAVAILABLE/FAILED
      else if (status === 'FAULTED' || status === 'UNAVAILABLE' || status === 'FAILED') {
        statusCounts.faulted++;
      }
      // Jeśli złącze ma status AVAILABLE ale ma aktywną transakcję, powinno być w charging
      // (ten przypadek jest już obsłużony wyżej)
    });

    // ===== FINANSE I WOLUMEN (w zadanym okresie) =====
    // Pobierz wszystkie zakończone transakcje w okresie z danymi stacji
    // endDate jest już ustawione na koniec dnia (23:59:59.999), więc użyjemy go bezpośrednio
    const completedTransactions = await prisma.transaction.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
        status: 'COMPLETED',
      },
      select: {
        finalCost: true,
        energyKwh: true,
        startTime: true,
        endTime: true,
        createdAt: true,
        station: {
          select: {
            pricePerKwh: true,
          },
        },
      },
    });

    // Total Revenue - suma finalCost (lub obliczone jako energyKwh * pricePerKwh jeśli finalCost null)
    let totalRevenue = 0;
    let totalEnergy = 0;
    const chartDataMap = new Map<string, { revenue: number; energy: number; sessions: number }>();

    completedTransactions.forEach((transaction) => {
      // Oblicz revenue: użyj finalCost jeśli dostępne, w przeciwnym razie oblicz z energyKwh * pricePerKwh
      const energyKwh = transaction.energyKwh ?? 0;
      const revenue = transaction.finalCost !== null && transaction.finalCost !== undefined
        ? transaction.finalCost
        : energyKwh * transaction.station.pricePerKwh;
      
      totalRevenue += revenue;
      totalEnergy += energyKwh;

      // Grupowanie po dniach dla chartData
      const dateKey = new Date(transaction.createdAt).toISOString().split('T')[0];
      const existing = chartDataMap.get(dateKey);
      if (existing) {
        existing.revenue += revenue;
        existing.energy += energyKwh;
        existing.sessions += 1;
      } else {
        chartDataMap.set(dateKey, {
          revenue,
          energy: energyKwh,
          sessions: 1,
        });
      }
    });

    // Generowanie pełnej tablicy wszystkich dni w zakresie dat
    const chartData: Array<{ date: string; revenue: number; energy: number; sessions: number }> = [];
    
    // Użyj porównania dat w formacie YYYY-MM-DD (string) aby uniknąć problemów ze strefami czasowymi
    const endDateKey = endDate.toISOString().split('T')[0];
    
    // Utwórz datę początkową dla iteracji (tylko data, bez czasu)
    const currentDate = new Date(startDate);
    currentDate.setHours(0, 0, 0, 0);
    
    // Iteruj przez wszystkie dni w zakresie (od startDate do endDate włącznie)
    // Używamy porównania dat w formacie string (YYYY-MM-DD) aby uniknąć problemów ze strefami czasowymi
    while (currentDate.toISOString().split('T')[0] <= endDateKey) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const existingData = chartDataMap.get(dateKey);
      
      if (existingData) {
        // Jeśli są dane dla tego dnia, użyj ich
        chartData.push({
          date: dateKey,
          revenue: Math.round(existingData.revenue * 100) / 100,
          energy: Math.round(existingData.energy * 100) / 100,
          sessions: existingData.sessions,
        });
      } else {
        // Jeśli nie ma danych, wpisz 0
        chartData.push({
          date: dateKey,
          revenue: 0,
          energy: 0,
          sessions: 0,
        });
      }
      
      // Przejdź do następnego dnia
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const totalSessions = completedTransactions.length;

    // Avg Cost - średni koszt sesji
    const avgCost = totalSessions > 0 ? totalRevenue / totalSessions : 0;

    // Avg kWh - średnia ilość kWh na sesję
    const avgKwh = totalSessions > 0 ? totalEnergy / totalSessions : 0;

    // Avg Duration - średni czas trwania sesji (w minutach)
    let totalDurationMinutes = 0;
    let validDurationsCount = 0;

    completedTransactions.forEach((transaction) => {
      if (transaction.endTime) {
        const start = new Date(transaction.startTime);
        const end = new Date(transaction.endTime);
        const durationMs = end.getTime() - start.getTime();
        const durationMinutes = durationMs / (1000 * 60);
        if (durationMinutes > 0) {
          totalDurationMinutes += durationMinutes;
          validDurationsCount++;
        }
      }
    });

    const avgDuration = validDurationsCount > 0 ? totalDurationMinutes / validDurationsCount : 0;

    res.json({
      // Złącza
      totalConnectors,
      statusCounts,
      // Finanse i wolumen
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalEnergy: Math.round(totalEnergy * 100) / 100,
      totalSessions,
      // Średnie
      avgCost: Math.round(avgCost * 100) / 100, // Zaokrąglenie do 2 miejsc po przecinku
      avgKwh: Math.round(avgKwh * 100) / 100,
      avgDuration: Math.round(avgDuration * 100) / 100,
      // Dane do wykresów
      chartData,
    });
  } catch (error) {
    logError('[Admin] Failed to fetch statistics', error);
    res.status(500).json({
      error: 'Failed to fetch statistics',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const updateStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, connectorType, pricePerKwh, status, address, city, latitude, longitude } = req.body;

    if (!id) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Station ID is required',
      });
      return;
    }

    const updateData: {
      name?: string;
      connectorType?: string;
      pricePerKwh?: number;
      status?: string;
      address?: string | null;
      city?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    } = {};

    if (name !== undefined && typeof name === 'string') {
      updateData.name = name;
    }

    if (connectorType !== undefined && typeof connectorType === 'string') {
      updateData.connectorType = connectorType;
    }

    if (pricePerKwh !== undefined) {
      if (typeof pricePerKwh !== 'number' || pricePerKwh <= 0) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'pricePerKwh must be a positive number',
        });
        return;
      }
      updateData.pricePerKwh = pricePerKwh;
    }

    if (status !== undefined && typeof status === 'string') {
      updateData.status = status;
    }

    if (address !== undefined) {
      updateData.address = address === null || address === '' ? null : String(address);
    }

    if (city !== undefined) {
      updateData.city = city === null || city === '' ? null : String(city);
    }

    if (latitude !== undefined) {
      if (latitude === null) {
        updateData.latitude = null;
      } else {
        const lat = typeof latitude === 'string' ? parseFloat(latitude) : latitude;
        if (lat === null || isNaN(lat)) {
          res.status(400).json({
            error: 'Invalid request',
            message: 'latitude must be a valid number',
          });
          return;
        }
        updateData.latitude = lat;
      }
    }

    if (longitude !== undefined) {
      if (longitude === null) {
        updateData.longitude = null;
      } else {
        const lng = typeof longitude === 'string' ? parseFloat(longitude) : longitude;
        if (lng === null || isNaN(lng)) {
          res.status(400).json({
            error: 'Invalid request',
            message: 'longitude must be a valid number',
          });
          return;
        }
        updateData.longitude = lng;
      }
    }

    logInfo('[Admin] Updating station', { stationId: id, updateData });

    const station = await prisma.station.update({
      where: { id },
      data: updateData,
    });

    logInfo('[Admin] Station updated successfully', { stationId: station.id });
    res.json(station);
  } catch (error) {
    logError('[Admin] Failed to update station', error);

    if (error instanceof Error && error.message.includes('Record to update does not exist')) {
      res.status(404).json({
        error: 'Station not found',
        message: 'The station with the provided ID does not exist',
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to update station',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const updateConnector = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { pricePerKwh, status, type, powerKw } = req.body;

    if (!id) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Connector ID is required',
      });
      return;
    }

    const updateData: {
      pricePerKwh?: number;
      status?: string;
      type?: string;
      powerKw?: number;
    } = {};

    if (pricePerKwh !== undefined) {
      if (typeof pricePerKwh !== 'number' || pricePerKwh <= 0) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'pricePerKwh must be a positive number',
        });
        return;
      }
      updateData.pricePerKwh = pricePerKwh;
    }

    if (status !== undefined && typeof status === 'string') {
      updateData.status = status;
    }

    if (type !== undefined && typeof type === 'string') {
      updateData.type = type;
    }

    if (powerKw !== undefined) {
      if (typeof powerKw !== 'number' || powerKw <= 0 || !Number.isInteger(powerKw)) {
        res.status(400).json({
          error: 'Invalid request',
          message: 'powerKw must be a positive integer',
        });
        return;
      }
      updateData.powerKw = powerKw;
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'At least one field (pricePerKwh, status, type, or powerKw) must be provided',
      });
      return;
    }

    logInfo('[Admin] Updating connector', { connectorId: id, updateData });

    const connector = await prisma.connector.update({
      where: { id },
      data: updateData,
    });

    logInfo('[Admin] Connector updated successfully', { connectorId: connector.id });
    res.json(connector);
  } catch (error) {
    logError('[Admin] Failed to update connector', error);

    if (error instanceof Error && error.message.includes('Record to update does not exist')) {
      res.status(404).json({
        error: 'Connector not found',
        message: 'The connector with the provided ID does not exist',
      });
      return;
    }

    res.status(500).json({
      error: 'Failed to update connector',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const deleteStation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Station ID is required',
      });
      return;
    }

    logInfo('[Admin] Deleting station', { stationId: id });

    // Sprawdź czy stacja istnieje
    const station = await prisma.station.findUnique({
      where: { id },
      include: {
        connectors: true,
        transactions: true,
      },
    });

    if (!station) {
      res.status(404).json({
        error: 'Station not found',
        message: 'The station with the provided ID does not exist',
      });
      return;
    }

    // Usuń stację wraz z złączami i transakcjami w transakcji
    await prisma.$transaction(async (tx) => {
      // Najpierw usuń wszystkie transakcje związane ze stacją
      await tx.transaction.deleteMany({
        where: { stationId: id },
      });

      // Następnie usuń wszystkie złącza stacji
      await tx.connector.deleteMany({
        where: { stationId: id },
      });

      // Na końcu usuń stację
      await tx.station.delete({
        where: { id },
      });
    });

    logInfo('[Admin] Station deleted successfully', { stationId: id });
    res.status(200).json({
      message: 'Station deleted successfully',
      stationId: id,
    });
  } catch (error) {
    logError('[Admin] Failed to delete station', error);
    res.status(500).json({
      error: 'Failed to delete station',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const deleteConnector = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    if (!id) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Connector ID is required',
      });
      return;
    }

    logInfo('[Admin] Deleting connector', { connectorId: id });

    // Sprawdź czy złącze istnieje
    const connector = await prisma.connector.findUnique({
      where: { id },
      include: {
        transactions: true,
      },
    });

    if (!connector) {
      res.status(404).json({
        error: 'Connector not found',
        message: 'The connector with the provided ID does not exist',
      });
      return;
    }

    // Usuń złącze wraz z transakcjami w transakcji
    await prisma.$transaction(async (tx) => {
      // Najpierw usuń wszystkie transakcje związane z złączem
      await tx.transaction.deleteMany({
        where: { connectorId: id },
      });

      // Następnie usuń złącze
      await tx.connector.delete({
        where: { id },
      });
    });

    logInfo('[Admin] Connector deleted successfully', { connectorId: id });
    res.status(200).json({
      message: 'Connector deleted successfully',
      connectorId: id,
    });
  } catch (error) {
    logError('[Admin] Failed to delete connector', error);
    res.status(500).json({
      error: 'Failed to delete connector',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

export const createConnector = async (req: Request, res: Response): Promise<void> => {
  try {
    const { stationId, name, type, powerKw, pricePerKwh, status } = req.body;

    logInfo('[Admin] Creating connector', { stationId, name, type, powerKw, pricePerKwh, status });

    // Walidacja wymaganych pól
    if (!stationId || typeof stationId !== 'string') {
      logError('[Admin] Invalid stationId in createConnector', { stationId, type: typeof stationId });
      res.status(400).json({
        error: 'Invalid request',
        message: 'stationId is required and must be a string',
      });
      return;
    }

    // name jest opcjonalne (może być undefined), ale jeśli jest podane, musi być stringiem
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'name must be a non-empty string if provided',
      });
      return;
    }

    if (!type || typeof type !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'type is required and must be a string',
      });
      return;
    }

    if (!powerKw || typeof powerKw !== 'number') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'powerKw is required and must be a number',
      });
      return;
    }

    if (powerKw <= 0 || !Number.isInteger(powerKw)) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'powerKw must be a positive integer',
      });
      return;
    }

    if (!pricePerKwh || typeof pricePerKwh !== 'number') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'pricePerKwh is required and must be a number',
      });
      return;
    }

    if (pricePerKwh <= 0) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'pricePerKwh must be greater than 0',
      });
      return;
    }

    // Sprawdź czy stacja istnieje
    const station = await prisma.station.findUnique({
      where: { id: stationId },
    });

    if (!station) {
      res.status(404).json({
        error: 'Station not found',
        message: 'The station with the provided ID does not exist',
      });
      return;
    }

    // Utwórz złącze - użyj tej samej logiki co w createStation
    const connectorData: {
      stationId: string;
      name?: string;
      type: string;
      powerKw: number;
      pricePerKwh: number;
      status: string;
    } = {
      stationId,
      type,
      powerKw,
      pricePerKwh,
      status: status || 'AVAILABLE',
    };

    // Dodaj name tylko jeśli jest podane (tak jak w createStation)
    if (name !== undefined && name.trim()) {
      connectorData.name = name.trim();
    }

    logInfo('[Admin] Creating connector with data', connectorData);

    const connector = await prisma.connector.create({
      data: connectorData,
    });

    logInfo('[Admin] Connector created successfully', { 
      connectorId: connector.id, 
      stationId: connector.stationId,
      type: connector.type,
      powerKw: connector.powerKw,
      pricePerKwh: connector.pricePerKwh
    });
    
    res.status(201).json(connector);
  } catch (error) {
    logError('[Admin] Failed to create connector', error);
    res.status(500).json({
      error: 'Failed to create connector',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

