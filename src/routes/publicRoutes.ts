import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { EntityId } from 'redis-om'
import { Controller } from '../../Controller.js'
import { ChatError, User } from '../../DatabaseType.js'

import {
    handleValidationResult,
    createUser,
    getUser,
} from './middleware.js'

const router = Router()

const ctl = new Controller()

router.get('/', (req, res) => {
    res.status(200).send('公開路由不需要 token')
})

// 註冊請求
router.post('/user', createUser)
// TODO - 獲取多個 user
router.get('/user/:id?', getUser)

// FIXME
// 登入請求
router.post('/users/login', 
    body('email')
        .notEmpty().withMessage('電郵不能為空')
        .isEmail().withMessage('電郵格式不正確'),
    body('password')
        .notEmpty().withMessage('密碼不能為空'),
    handleValidationResult,
    async (req, res, next) => {
        let user = await ctl.loginWithEmail(req.body.email, req.body.password)
        if (user.err !== undefined) return res.status(400).send(user.err)
        
        req.user = {
            userID: user.userID,
            name  : user.name,
            email : user.email,
            token : user.token
        }
        return next()
    }
)

// TODO - 處理沒有對應的ID
router.post('/users/data',
    body('userID').notEmpty().withMessage('需要 userID'),
    handleValidationResult,
    async (req, res) => {
        if (Array.isArray(req.body.userID)) {
            const userPublicDatas = await Promise.all(req.body.userID.map((id: string) => {
                return ctl.getPublicData('user', id)
            }))
            console.log(userPublicDatas)
            return res.send(userPublicDatas)
        }
        const userPublicData = await ctl.getPublicData('user', req.body.userID)
        console.log(userPublicData)
        return res.json(userPublicData)
    }
)
// TODO - 處理沒有對應的ID
router.post('/groups/data',
    body('groupID').notEmpty().withMessage('需要 groupID'),
    handleValidationResult,
    async (req, res) => {
        const userPublicData = await ctl.getPublicData('group', req.body.userID)
        return res.json(userPublicData)
    }
)


export default router
