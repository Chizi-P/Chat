import { Router } from 'express'
import {
    createUser,
    getUser,
    updateUser,
    deleteUser,
} from '../controllers/usersControllers.js'

const router = Router()

router.post  ('/user',      createUser)
router.get   ('/user/:id?', getUser)
router.put   ('/user/:id?', updateUser)
router.delete('/user/:id?', deleteUser)

export default router