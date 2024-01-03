import { NextFunction, Router, Request, Response } from 'express'
import { body } from 'express-validator'
import { Controller } from '../Controller.js'

import { handleValidationResult, ok, not } from './func.js'
import { RepositoriesType } from '../schema.js'

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
async function checkPermissions(repo: keyof RepositoriesType, key: string | string[], bodyKey: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const user = await ctl.getData(repo, req.user.userID)
        if (!Array.isArray(key)) key = [key]
        if (key.some(e => {
            const val = user[e]
            return Array.isArray(val) && val.includes(req.body[bodyKey])
        })) return next()
        return res.json(not(`沒有權限訪問 ${req.body[bodyKey]}`))
    }
}

router.post('/group/data',
    body('groupID').notEmpty().withMessage('需要 groupID'),
    handleValidationResult,
    await checkPermissions('user', ['groups', 'directGroups'], 'groupID'),
    async (req, res) => {
        const group = await ctl.getData('group', req.body.groupID)
        console.log(group)
        return res.json(group)
    }
)

// TODO - message page
// TODO - 根據最後一條 messageID 返回之後的數據
// TODO - 展開所有數據

router.post('/message/data',
    body('messageID').notEmpty().withMessage('需要 messageID'),
    handleValidationResult,
    async (req, res) => {
        const message = await ctl.getData('message', req.body.messageID)
        if (!(message.from === req.user.userID || message.to === req.user.userID)) {
            return res.json(not(`沒有權限訪問 ${req.body.messageID}`))
        }
        console.log('message', message)
        return res.json(message)
    }
)

// OPT - 獲取多條
router.post('/task/data',
    body('taskID').notEmpty().withMessage('需要 taskID'),
    handleValidationResult,
    await checkPermissions('user', 'groups', 'groupID'),
    async (req, res) => {
        let task = await ctl.getData('task', req.body.taskID)
        return res.json(task)
    }
)

export default router