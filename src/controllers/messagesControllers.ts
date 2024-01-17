import { NextFunction, Request, Response } from 'express'
import { body, param } from 'express-validator'
import { ctl } from '../../server.js'
import { Message } from '../../DatabaseType.js'

import { handleValidationResult } from './middleware.js'

async function isSender(req: Request, res: Response, next: NextFunction) { // 檢查權限
    const { id } = req.params
    const message = await ctl.db.repos.message.fetch(id) as Message
    if (req.user.userID !== message.from) {
        return res.status(401).send(`user:${req.user.userID} 沒有權限修改 message:${id}`)
    }
    next()
}

const paramIdExisted = param('id').notEmpty().withMessage('需要訊息ID').bail()
    .custom(async id => await ctl.messageExisted(id) ? Promise.resolve() : Promise.reject('該訊息不存在'))

const createMessage = [
    body('to')
        .notEmpty().withMessage('發送對象不能為空'),
    body('type')
        .notEmpty().withMessage('沒有訊息類型'),
    body('content')
        .notEmpty().withMessage('訊息內容不能為空'),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { to, type, content } = req.body
        const message = await ctl.createMessage(req.user.userID, to, type, content) as Message
        return res.status(201).send(message)
    }
]

const getMessage = [
    paramIdExisted,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const message = await ctl.db.repos.message.fetch(id) as Message
        if (message.from === req.user.userID || await ctl.isMember(req.user.userID, message.to)) {
            return res.status(200).send(message)
        }
        return res.status(401).send('沒有權限查看該訊息')
    }
]

const updateMessage = [
    paramIdExisted,
    isSender,
    body('content').notEmpty().withMessage('沒有修改的內容'),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        // FIXME - 控制可以修改的項目
        const { content } = req.body
        let message = await ctl.db.repos.message.fetch(id) as Message
        message.content = content
        message = await ctl.db.repos.group.save(message) as Message
        return res.status(200).send(message)
    }
]

const deleteMessage = [
    paramIdExisted,
    isSender,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const message = await ctl.db.repos.message.fetch(id)
        await ctl.db.repos.message.remove(id)
        return res.status(201).send(message)
    }
]

export {
    createMessage,
    getMessage,
    updateMessage,
    deleteMessage,
}