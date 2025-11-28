import { Router } from 'express';
import { getStations, createStation, getTransactions, getStats, updateStation } from '../controllers/adminController';

const router = Router();

router.get('/stations', getStations);
router.post('/stations', createStation);
router.put('/stations/:id', updateStation);
router.get('/transactions', getTransactions);
router.get('/stats', getStats);

export default router;

