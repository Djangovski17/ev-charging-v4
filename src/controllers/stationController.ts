import { Request, Response } from 'express';
import { prisma } from '../services/prisma';
import { logError, logInfo } from '../services/logger';

/**
 * GET /api/stations
 * Zwraca listę wszystkich stacji z obliczonym statusem dostępności
 * Status jest obliczany na podstawie aktywnych transakcji (CHARGING, ACTIVE, PENDING)
 */
export const getAllStations = async (_req: Request, res: Response): Promise<void> => {
  try {
    logInfo('[Stations] Fetching all stations with availability status');
    
    // Pobierz wszystkie stacje z złączami
    const stations = await prisma.station.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        latitude: true,
        longitude: true,
        pricePerKwh: true,
        connectors: {
          select: {
            id: true,
            type: true,
            powerKw: true,
            status: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Pobierz wszystkie aktywne transakcje z connectorId (dla wszystkich stacji jednocześnie)
    const activeTransactions = await prisma.transaction.findMany({
      where: {
        status: {
          in: ['CHARGING', 'ACTIVE', 'PENDING'],
        },
      },
      select: {
        stationId: true,
        connectorId: true,
      },
    });

    // Utwórz Map: stationId -> Set of connectorIds z aktywnymi transakcjami
    const activeConnectorsByStation = new Map<string, Set<string>>();
    activeTransactions.forEach(transaction => {
      if (transaction.connectorId) {
        if (!activeConnectorsByStation.has(transaction.stationId)) {
          activeConnectorsByStation.set(transaction.stationId, new Set());
        }
        activeConnectorsByStation.get(transaction.stationId)!.add(transaction.connectorId);
      }
    });

    // Utwórz Set z ID stacji, które mają aktywne transakcje (dla statusu stacji)
    const busyStationIds = new Set(activeTransactions.map(t => t.stationId));

    // Dodaj status i oblicz availableCount dla każdej stacji
    const stationsWithStatus = stations.map(station => {
      // Pobierz złącza ze statusem 'AVAILABLE'
      const availableConnectors = station.connectors.filter(c => c.status === 'AVAILABLE');
      
      // Pobierz Set złączy z aktywnymi transakcjami dla tej stacji
      const activeConnectorIds = activeConnectorsByStation.get(station.id) || new Set();
      
      // Oblicz availableCount: złącza AVAILABLE minus te z aktywnymi transakcjami
      const availableCount = availableConnectors.filter(
        connector => !activeConnectorIds.has(connector.id)
      ).length;
      
      return {
        id: station.id,
        name: station.name,
        address: station.address,
        city: station.city,
        latitude: station.latitude,
        longitude: station.longitude,
        pricePerKwh: station.pricePerKwh,
        status: busyStationIds.has(station.id) ? 'Busy' : 'Available',
        connectors: station.connectors,
        availableCount, // Dodaj obliczoną wartość
      };
    });

    logInfo('[Stations] Returning stations', { count: stationsWithStatus.length });
    res.json({
      success: true,
      stations: stationsWithStatus,
    });
  } catch (error) {
    logError('[Stations] Failed to fetch stations', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stations',
      message: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
};

