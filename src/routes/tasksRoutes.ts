import { Router } from 'express'
import {
    createTask,
    getTask,
    updateTask,
    deleteTask,
} from '../controllers/tasksControllers.js'

const router = Router()

router.post  ('/task',      createTask)
router.get   ('/task/:id?', getTask)
router.put   ('/task/:id?', updateTask)
router.delete('/task/:id?', deleteTask)

export default router