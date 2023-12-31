import { NextFunction, Router, Request, Response } from 'express'
import { Controller } from '../Controller.js'
import { body, validationResult } from 'express-validator'

import { handleValidationResult, ok, not } from './func.js'

const router = Router()

const ctl = new Controller()

router.use(
    body('token').notEmpty().withMessage('需要 token'),
    handleValidationResult,
    async (req, res, next) => {
        let user = await ctl.loginWithToken(req.body.token)
        if (user.err !== undefined) return res.json(not(user.err))
        
        req.user = {
            userID : user.userID,
            name   : user.name,
            email  : user.email,
            token  : user.token
        }
        return next()
    }
)

router.post('/user', async (req, res) => {
    let user = await ctl.getUser(req.user.userID)
    // 忽略 hashedPassword
    const { hashedPassword, ...userData } = user
    return res.json(userData)
})

export default router