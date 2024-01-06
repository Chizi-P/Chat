import { NextFunction, Request, Response } from 'express'
import { body, param } from 'express-validator'
import { ctl } from '../../server.js'
import { ChatEvents, Task } from '../../DatabaseType.js'

import { handleValidationResult } from './middleware.js'

async function isAllocator(req: Request, res: Response, next: NextFunction) { // 檢查權限
    const { id } = req.params
    const task = await ctl.db.repos.task.fetch(id) as Task
    if (req.user.userID !== task.creator && req.user.userID !== task.from) {
        return res.status(401).send(`user:${req.user.userID} 沒有權限修改 task:${id}`)
    }
    next()
}

const paramIdExisted = param('id').notEmpty().withMessage('需要任務ID').bail()
    .custom(async id => await ctl.taskExisted(id) ? Promise.resolve() : Promise.reject('該任務不存在'))


const createTask = [
    body('to')
        .notEmpty().withMessage('對象不能為空'),
    body('eventType')
        .notEmpty().withMessage('事件類型不能為空').bail()
        .custom(eventType => {
            return Object.values(ChatEvents).includes(eventType) ? Promise.resolve() : Promise.reject(`沒有 ${eventType} 事件類型`)
        }),
    body('creator')
        .optional(),
    body('content')
        .optional(),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { to, eventType, creator, content } = req.body
        
        const tasks = await ctl.createTask({from: req.user.userID, to, eventType, creator, content}) as Task[]
        return res.status(201).send(tasks)
    }
]

const getTask = [
    paramIdExisted,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const task = await ctl.db.repos.task.fetch(id) as Task
        if (task.from === req.user.userID || task.creator === req.user.userID) {
            return res.status(200).send(task)
        }
        return res.status(401).send('沒有權限查看該訊息')
    }
]

const updateTask = [
    paramIdExisted,
    isAllocator,
    body('content').optional().isString(),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const { content } = req.body
        let task = await ctl.db.repos.task.fetch(id) as Task
        task.content = content
        task = await ctl.db.repos.group.save(task) as Task
        return res.status(200).send(task)
    }
]

const deleteTask = [
    paramIdExisted,
    isAllocator,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const task = await ctl.db.repos.task.fetch(id)
        await ctl.cancelTask(id)
        return res.status(201).send(task)
    }
]

export {
    createTask,
    getTask,
    updateTask,
    deleteTask,
}