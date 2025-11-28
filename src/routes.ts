import { Express } from 'express';
import healthRoutes from './routes/healthRoutes';
import startRoutes from './routes/startRoutes';
import paymentRoutes from './routes/paymentRoutes';
import adminRoutes from './routes/adminRoutes';
import stationRoutes from './routes/stationRoutes';

export const registerRoutes = (app: Express): void => {
  // Rejestracja routingu - kolejność ma znaczenie!
  // Najpierw specyficzne ścieżki, potem ogólne
  app.use('/health', healthRoutes);
  app.use('/admin', adminRoutes);
  app.use('/api', stationRoutes); // /api/stations
  app.use('/', startRoutes); // /start/:cpId będzie tutaj
  app.use('/', paymentRoutes);
  
  // Handler 404 dla niezarejestrowanych route'ów
  app.use((req, res) => {
    console.log(`[404] Nie znaleziono route'a: ${req.method} ${req.path}`);
    res.status(404).json({
      success: false,
      message: `Route not found: ${req.method} ${req.path}`,
    });
  });
};

