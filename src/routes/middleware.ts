import { NextFunction, Request, Response } from 'express'
import { body, param, query, validationResult } from 'express-validator'
import { ctl } from '../../server.js'
import { User } from '../../DatabaseType.js'


// - self 需要附帶 token
// - user / users 不需要 token
// create 201
// read   200
// update 200
// delete 200

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

const createUser = [
    // TODO - 名稱的限制
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

const getUser = [
    param('id').notEmpty().withMessage('需要用户ID').bail()
    .custom(async id => await ctl.userExisted(id) ? Promise.resolve() : Promise.reject('該用戶不存在')),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const user = await ctl.getPublicData('user', id)
        return res.status(200).send(user)
    }
]

// TODO - 展開數據中的 id
async function getSelf(req: Request, res: Response, next: NextFunction) {
    const user = await ctl.db.repos.user.fetch(req.user.userID)
    return res.status(200).send(user)
}


const updateSelf = [
    body('name').optional().isString(),
    body('email').optional().isEmail(),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        // const { data } = req.body
        // Object.entries(data).forEach(([key, val]: [string, any]) => {
        //     user[key] = val
        // })

        // TODO - 修改所需要的其他流程
        // email 驗證
    
        // FIXME - 控制可以修改的項目
        const { name, email, password } = req.body
        let user = await ctl.db.repos.user.fetch(req.user.userID) as User
        user.name = name
        user.email = email
        user = await ctl.db.repos.user.save(user) as User
        return res.status(200).send(user)
    }
]


async function deleteSelf(req: Request, res: Response, next: NextFunction) {
    const user = await ctl.db.repos.user.fetch(req.user.userID)
    await ctl.db.repos.user.remove(req.user.userID)
    return res.status(201).send(user)
}

export {
    handleValidationResult,
    validateToken,
    createUser,
    getUser,
    getSelf,
    updateSelf,
    deleteSelf,
}