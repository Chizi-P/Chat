import { NextFunction, Request, Response } from 'express'
import { body, param } from 'express-validator'
import { ctl } from '../../server.js'
import { User } from '../../DatabaseType.js'

import { handleValidationResult } from './middleware.js'

function isSelf(req: Request, res: Response, next: NextFunction) { // 檢查權限
    const { id } = req.params
    if (req.user.userID !== id) {
        return res.status(401).send(`user:${req.user.userID} 沒有權限修改 user:${id}`)
    }
    next()
}

const paramIdExisted = param('id').notEmpty().withMessage('需要用户ID').bail()
    .custom(async id => await ctl.userExisted(id) ? Promise.resolve() : Promise.reject('該用戶不存在'))


const createUser = [
    body('name')
        .notEmpty().withMessage('名稱不能為空'),
    body('email')
        .notEmpty().withMessage('電郵不能為空').bail()
        .isEmail().withMessage('電郵格式不正確').bail()
        .custom(async email => await ctl.emailExisted(email) ? Promise.reject('電郵已被使用') : Promise.resolve('電郵可用')),
    body('password')
        .notEmpty().withMessage('密碼不能為空').bail()
        .isLength({ min: 8 }).withMessage('密碼最少要10個'),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, email, password } = req.body
        const user = await ctl.createUser(name, email, password) as User
        const omitted = ctl.omit(user, 'hashedPassword')
        return res.status(201).send(omitted)
    }
]

// 不需要 id
const getSelf = [
    async (req: Request, res: Response, next: NextFunction) => {
        const user = ctl.omit(await ctl.db.repos.user.fetch(req.user.userID) as User, 'hashedPassword')
        return res.status(200).send(user)
    }
]

// TODO - 展開數據中的 id
const getUser = [
    paramIdExisted,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const user = id === req.user.userID 
            ? ctl.omit(await ctl.db.repos.user.fetch(req.user.userID) as User, 'hashedPassword')
            : await ctl.getPublicData('user', id)
        return res.status(200).send(user)
    }
]

// 不需要 id
const updateSelf = [
    body('name').optional().isString(),
    body('email').optional().isEmail(),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        // TODO - 修改所需要的其他流程
        // email 驗證
    
        // FIXME - 控制可以修改的項目
        const { name, email } = req.body
        let user = await ctl.db.repos.user.fetch(req.user.userID) as User
        user.name = name
        user.email = email
        user = await ctl.db.repos.user.save(user) as User
        return res.status(200).send(user)
    }
]

const updateUser = [
    paramIdExisted,
    isSelf,
    body('name').optional().isString(),
    body('email').optional().isEmail(),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        // const { data } = req.body
        // Object.entries(data).forEach(([key, val]: [string, any]) => {
        //     user[key] = val
        // })

        // TODO - 修改所需要的其他流程
        // email 驗證
    
        // FIXME - 控制可以修改的項目
        
        const { name, email } = req.body
        let user = await ctl.db.repos.user.fetch(id) as User
        user.name = name
        user.email = email
        user = await ctl.db.repos.user.save(user) as User
        return res.status(200).send(user)
    }
]

const deleteSelf = [
    async (req: Request, res: Response, next: NextFunction) => {
        const user = await ctl.db.repos.user.fetch(req.user.userID)
        await ctl.db.repos.user.remove(req.user.userID)
        return res.status(201).send(user)
    }
]

const deleteUser = [
    paramIdExisted,
    isSelf,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const user = await ctl.db.repos.user.fetch(id)
        await ctl.db.repos.user.remove(id)
        return res.status(201).send(user)
    }
]

const login = [
    body('email')
        .notEmpty().withMessage('電郵不能為空').bail()
        .isEmail().withMessage('電郵格式不正確').bail()
        .custom(async email => await ctl.emailExisted(email) ? Promise.resolve('電郵可用') : Promise.reject('電郵還沒註冊')),
    body('password')
        .notEmpty().withMessage('密碼不能為空'),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { email, password } = req.body
        const user = await ctl.loginWithEmail(email, password)

        if (user.err !== undefined) return res.status(401).send('密碼錯誤')
        
        req.user = {
            userID : user.userID,
            name   : user.name,
            email  : user.email,
            token  : user.token
        }

        return res.status(201).send(user)
    }
]

export {
    createUser,
    getSelf,
    getUser,
    updateSelf,
    updateUser,
    deleteSelf,
    deleteUser,
    login,
}