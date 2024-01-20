import { NextFunction, Router, Request, Response } from 'express'
import { validationResult } from 'express-validator'


const ok  = (msg: any) => ({ ok: true,  msg })
const not = (msg: any) => ({ ok: false, msg })

// function handleValidationResult(req: Request, res: Response, next: NextFunction) {
//     const errors = validationResult(req)
//     if (!errors.isEmpty()) return res.status(400).json(not(errors.array()))
//     next()
// }

export {
    ok,
    not,
    // handleValidationResult
}