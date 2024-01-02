import { NextFunction, Router, Request, Response } from 'express'
import { body } from 'express-validator'
import { Controller } from '../Controller.js'

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

router.post('/user/data', 
    async (req, res) => {
        let user = await ctl.getData('user', req.user.userID)
        // 忽略 hashedPassword
        const { hashedPassword, ...userData } = user
        return res.json(userData)
    }
)

// 檢查用戶是否有權限訪問這個id
async function checkPermissions(key: string, bodyKey: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const user = await ctl.getData('user', req.user.userID)
        const val = user[key]
        if (Array.isArray(val) && val.includes(req.body[bodyKey])) return next()
        return res.json(not(`沒有權限訪問 ${req.body[bodyKey]}`))
    }
}

router.post('/group/data',
    body('groupID').notEmpty().withMessage('需要 groupID'),
    handleValidationResult,
    await checkPermissions('groups', 'groupID'),
    async (req, res) => {
        const group = await ctl.getData('group', req.body.groupID)
        return res.json(group)
    }
)

// OPT - 獲取多條
router.post('/task/data',
    body('taskID').notEmpty().withMessage('需要 taskID'),
    handleValidationResult,
    await checkPermissions('groups', 'groupID'),
    async (req, res) => {
        let task = await ctl.getData('task', req.body.taskID)
        return res.json(task)
    }
)

export default router