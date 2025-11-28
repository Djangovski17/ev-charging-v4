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
    
    // Pobierz wszystkie stacje
    const stations = await prisma.station.findMany({
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        latitude: true,
        longitude: true,
        pricePerKwh: true,
      },
      orderBy: { name: 'asc' },
    });

    // Pobierz wszystkie aktywne transakcje (dla wszystkich stacji jednocześnie)
    const activeTransactions = await prisma.transaction.findMany({
      where: {
        status: {
          in: ['CHARGING', 'ACTIVE', 'PENDING'],
        },
      },
      select: {
        stationId: true,
      },
    });

    // Utwórz Set z ID stacji, które mają aktywne transakcje
    const busyStationIds = new Set(activeTransactions.map(t => t.stationId));

    // Dodaj status do każdej stacji
    const stationsWithStatus = stations.map(station => ({
      id: station.id,
      name: station.name,
      address: station.address,
      city: station.city,
      latitude: station.latitude,
      longitude: station.longitude,
      pricePerKwh: station.pricePerKwh,
      status: busyStationIds.has(station.id) ? 'Busy' : 'Available',
    }));

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

