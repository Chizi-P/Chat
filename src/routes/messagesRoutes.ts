import { Router } from 'express'
import {
    createMessage,
    getMessage,
    updateMessage,
    deleteMessage,
} from '../controllers/messagesControllers.js'

const router = Router()

router.post  ('/message',      createMessage)
router.get   ('/message/:id?', getMessage)
router.put   ('/message/:id?', updateMessage)
router.delete('/message/:id?', deleteMessage)

export default router