import { Router } from 'express'
import {
    createGroup,
    getGroup,
    updateGroup,
    deleteGroup,
} from '../controllers/groupsControllers.js'

const router = Router()

router.post  ('/group',      createGroup)
router.get   ('/group/:id?', getGroup)
router.put   ('/group/:id?', updateGroup)
router.delete('/group/:id?', deleteGroup)

export default router