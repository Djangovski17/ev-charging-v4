import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { logError, logInfo } from '../services/logger';

export const getStations = async (_req: Request, res: Response): Promise<void> => {
  try {
    logInfo('[Admin] Fetching all stations');
    const stations = await prisma.station.findMany({
      orderBy: { createdAt: 'desc' },
    });
    res.json(stations);
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
    const { id, name, connectorType, pricePerKwh, status } = req.body;

    if (!name || typeof name !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'name is required and must be a string',
      });
      return;
    }

    if (!connectorType || typeof connectorType !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'connectorType is required and must be a string',
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

    logInfo('[Admin] Creating new station', { id, name, connectorType, pricePerKwh });

    const stationData: {
      name: string;
      connectorType: string;
      pricePerKwh: number;
      status: string;
      id?: string;
    } = {
      name,
      connectorType,
      pricePerKwh,
      status: status || 'AVAILABLE',
    };

    // Jeśli ID zostało podane, użyj go (inaczej Prisma wygeneruje UUID)
    if (id && typeof id === 'string') {
      stationData.id = id;
    }

    const station = await prisma.station.create({
      data: stationData,
    });

    logInfo('[Admin] Station created successfully', { stationId: station.id });
    res.status(201).json(station);
  } catch (error) {
    logError('[Admin] Failed to create station', error);

    // Sprawdź czy to błąd duplikacji ID
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(409).json({
        error: 'Duplicate station ID',
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
      // Ustaw endDate na koniec dnia (następny dzień, 00:00:00)
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Domyślnie: dzisiejszy dzień
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      startDate = today;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      endDate = tomorrow;
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
    // Total Connectors - całkowita liczba stacji (każda stacja = jedno złącze)
    const totalConnectors = await prisma.station.count();

    // Status Counts - liczniki statusów stacji
    const stations = await prisma.station.findMany({
      select: {
        status: true,
      },
    });

    const statusCounts = {
      available: 0,
      charging: 0,
      faulted: 0,
      total: totalConnectors,
    };

    stations.forEach((station) => {
      const status = station.status.toUpperCase();
      if (status === 'AVAILABLE') {
        statusCounts.available++;
      } else if (status === 'CHARGING' || status === 'OCCUPIED' || status === 'PENDING') {
        statusCounts.charging++;
      } else if (status === 'UNAVAILABLE' || status === 'FAILED' || status === 'FAULTED') {
        statusCounts.faulted++;
      }
    });

    // ===== FINANSE I WOLUMEN (w zadanym okresie) =====
    // Pobierz wszystkie zakończone transakcje w okresie z danymi stacji
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
      const revenue = transaction.finalCost !== null && transaction.finalCost !== undefined
        ? transaction.finalCost
        : transaction.energyKwh * transaction.station.pricePerKwh;
      
      totalRevenue += revenue;
      totalEnergy += transaction.energyKwh || 0;

      // Grupowanie po dniach dla chartData
      const dateKey = new Date(transaction.createdAt).toISOString().split('T')[0];
      const existing = chartDataMap.get(dateKey);
      if (existing) {
        existing.revenue += revenue;
        existing.energy += transaction.energyKwh || 0;
        existing.sessions += 1;
      } else {
        chartDataMap.set(dateKey, {
          revenue,
          energy: transaction.energyKwh || 0,
          sessions: 1,
        });
      }
    });

    // Konwersja chartDataMap do tablicy obiektów
    const chartData = Array.from(chartDataMap.entries())
      .map(([date, data]) => ({
        date,
        revenue: Math.round(data.revenue * 100) / 100,
        energy: Math.round(data.energy * 100) / 100,
        sessions: data.sessions,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

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
    const { name, connectorType, pricePerKwh, status } = req.body;

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

