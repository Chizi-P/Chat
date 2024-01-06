import { NextFunction, Request, Response } from 'express'
import { body, param } from 'express-validator'
import { ctl } from '../../server.js'
import { Group } from '../../DatabaseType.js'

import { handleValidationResult } from './middleware.js'

// create 201
// read   200
// update 200
// delete 200

// FIXME - 管理員也可以改
async function isCreator(req: Request, res: Response, next: NextFunction) { // 檢查權限
    const { id } = req.params
    const group = await ctl.db.repos.group.fetch(id) as Group
    if (req.user.userID !== group.creator) {
        return res.status(401).send(`user:${req.user.userID} 沒有權限修改 group:${id}`)
    }
    next()
}

const paramIdExisted = param('id').notEmpty().withMessage('需要群組ID').bail()
    .custom(async id => await ctl.groupExisted(id) ? Promise.resolve() : Promise.reject('該群組不存在'))


const createGroup = [
    body('name')
        .notEmpty().withMessage('名稱不能為空'),
    body('avatar')
        .notEmpty().withMessage('密碼不能為空').bail()
        .isLength({ min: 8 }).withMessage('密碼最少要10個'),
    body('invitedMembers')
        .optional().isArray().withMessage('invitedMembers 應該是個 Array<UserID>'),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { name, avatar, invitedMembers } = req.body
        const group = await ctl.createGroup(name, req.user.userID, avatar, invitedMembers) as Group
        return res.status(201).send(group)
    }
]

const getGroup = [
    paramIdExisted,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const group = await ctl.isMember(req.user.userID, id) 
            ? await ctl.db.repos.group.fetch(id) 
            : await ctl.getPublicData('group', id)
        return res.status(200).send(group)
    }
]

// TODO - 展開數據中的 id
const updateGroup = [
    paramIdExisted,
    isCreator,
    body('name').optional().isString(),
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        // FIXME - 控制可以修改的項目
        const { name } = req.body
        let group = await ctl.db.repos.group.fetch(id) as Group
        group.name = name
        group = await ctl.db.repos.group.save(group) as Group
        return res.status(200).send(group)
    }
]

const deleteGroup = [
    paramIdExisted,
    isCreator,
    handleValidationResult,
    async (req: Request, res: Response, next: NextFunction) => {
        const { id } = req.params
        const group = await ctl.db.repos.group.fetch(id)
        await ctl.db.repos.group.remove(id)
        return res.status(201).send(group)
    }
]

export {
    createGroup,
    getGroup,
    updateGroup,
    deleteGroup,
}