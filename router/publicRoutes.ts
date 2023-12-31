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

// 登入頁面
router.get('/users/login', (req, res) => {
    res.json('login page')
})

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


export default router
