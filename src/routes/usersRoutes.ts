import { Router } from 'express'
import {
    createUser,
    getSelf,
    getUser,
    updateSelf,
    updateUser,
    deleteSelf,
    deleteUser,
} from '../controllers/usersControllers.js'

const router = Router()

router.post  ('/user',      createUser)
router.get   ('/user',      getSelf)
router.get   ('/user/:id?', getUser)
router.put   ('/user',      updateSelf)
router.put   ('/user/:id?', updateUser)
router.delete('/user',      deleteSelf)
router.delete('/user/:id?', deleteUser)

// router.get('/user/friends', getUserFriends)


export default router