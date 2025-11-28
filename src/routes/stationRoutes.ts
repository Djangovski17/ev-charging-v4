import { Router } from 'express';
import { getAllStations } from '../controllers/stationController';

const router = Router();

router.get('/stations', getAllStations);

export default router;

