import { Router } from 'express';
import { getStations, createStation, getTransactions, getStats, updateStation, updateConnector, deleteStation, deleteConnector, createConnector } from '../controllers/adminController';

const router = Router();

router.get('/stations', getStations);
router.post('/stations', createStation);
router.post('/station', createStation); // Nowy endpoint zgodny z wymaganiami
router.put('/stations/:id', updateStation);
router.delete('/station/:id', deleteStation);
router.post('/connector', createConnector);
router.put('/connectors/:id', updateConnector);
router.delete('/connector/:id', deleteConnector);
router.get('/transactions', getTransactions);
router.get('/stats', getStats);

export default router;

