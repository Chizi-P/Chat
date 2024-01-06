import { NextFunction, Request, Response } from 'express'
import { body, param, validationResult } from 'express-validator'
import { ctl } from '../../server.js'

function handleValidationResult(req: Request, res: Response, next: NextFunction) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) return res.status(400).send(errors.array())
    next()
}

const validateToken = [
    body('token').notEmpty().withMessage('需要 token'),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const user = await ctl.loginWithToken(req.body.token)
        if (user.err !== undefined) return res.status(401).send(user.err)
        
        req.user = {
            userID : user.userID,
            name   : user.name,
            email  : user.email,
            token  : user.token
        }
        next()
    }
]

export {
    handleValidationResult,
    validateToken,
}