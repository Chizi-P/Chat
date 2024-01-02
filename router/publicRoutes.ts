import { Router } from 'express'
import { body, validationResult } from 'express-validator'
import { Controller } from '../Controller.js'
import { ChatError } from '../DatabaseType.js'
import { handleValidationResult, ok, not } from './func.js'

const router = Router()

const ctl = new Controller()

router.get('/', (req, res) => {
    res.json({ ok: true, msg: '公開路由不需要 token' })
})

// 註冊頁面
router.get('/users/register', (req, res) => {
    res.json('register page')
})

// 登入頁面
router.get('/users/login', (req, res) => {
    res.json('login page')
})

// 註冊請求
router.post('/users/register', 
    body('name')
        .notEmpty().withMessage('名稱不能為空'),
    body('email')
        .notEmpty().withMessage('電郵不能為空')
        .isEmail().withMessage('電郵格式不正確').bail()
        .custom(async email => await ctl.emailExisted(email) ? Promise.reject('電郵已被使用') : Promise.resolve('電郵可用')),
    body('password')
        .notEmpty().withMessage('密碼不能為空')
        .isLength({ min: 8 }).withMessage('密碼最少要10個'),
    handleValidationResult,
    async (req, res) => {
        const { name, email, password } = req.body
        const userID = await ctl.createUser(name, email, password)
        ctl.log('userID:', userID)
        return res.json(ok('註冊成功'))
    }
)

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
        if (user.err !== undefined) return res.json(not(user.err))
        
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
