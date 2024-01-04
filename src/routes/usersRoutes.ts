import { NextFunction, Router, Request, Response } from 'express'
import { body } from 'express-validator'
import { Controller } from '../../Controller.js'

import { handleValidationResult, ok, not } from './func.js'

import { getSelf, updateSelf, deleteSelf, createUser, getUser } from './middleware.js'

const router = Router()

router.post('/user', createUser)
router.get('/user/:id', getUser)

router.get('/self', getSelf)
router.put('/self', updateSelf)
router.delete('/self', deleteSelf)


export default router