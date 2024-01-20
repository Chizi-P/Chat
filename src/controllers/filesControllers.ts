import multer from 'multer'
import { Request, Response, NextFunction } from 'express'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { ctl } from '../../server.js'
import sharp from 'sharp'
import { encode } from 'blurhash'
import { param, query } from 'express-validator'
import { File, FileTypes } from '../../DatabaseType.js'
import { handleValidationResult } from './middleware.js'

const paramIdExisted = param('id').notEmpty().withMessage('需要文件ID').bail()
    .custom(async id => await ctl.fileExisted(id) ? Promise.resolve() : Promise.reject('該文件不存在'))

const isOwner = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params
    const file = await ctl.db.repos.file.fetch(id) as File
    if (file.owner.some(e => e === req.user.userID)) {
        return next()
    }
    res.status(400).send()
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/')
    },
    filename: async (req, file, cb) => {
        const suffix = path.extname(file.originalname)
        const fileType = file.mimetype.split('/')[0]
        const fileID = await ctl.createFile({
            creator      : req.user.userID, 
            type         : fileType,
            suffix       : suffix,
            originalname : file.originalname,
            destination  : file.destination,
            size         : file.size
        })
        cb(null, fileID + suffix)
    }
})

function encodeImageToBlurhash(path: string) {
    return new Promise((resolve, reject) => {
        sharp(path)
            .raw()
            .ensureAlpha()
            .resize(32, 32, { fit: 'inside' })
            .toBuffer((err, buffer, { width, height }) => {
                if (err) return reject(err)
                // if (width == undefined || height == undefined) return reject()
                resolve(encode(new Uint8ClampedArray(buffer), width, height, 4, 4))
            })
    })
}

const getFile = [
    param('id').custom(id => {
        if (/[.]{2}/.test(id)) return Promise.reject('惡意攻擊')
        return Promise.resolve()
    }),
    paramIdExisted,
    query('blurhash').optional().isString().isIn(['true', 'false']).withMessage('blurhash 可選 true'),
    handleValidationResult,
    isOwner,
    async (req: Request, res: Response) => {
        const { id } = req.params

        const file = await ctl.db.repos.file.fetch(id) as File
        const filePath = path.join(process.cwd(), '/uploads', id + file.suffix)

        if (!fs.existsSync(filePath)) {
            console.error('Error: File does not exist:', filePath)
            return res.status(400).send('File does not exist')
        }

        switch (file.type) {
            case FileTypes.image:
                if (req.query.blurhash === 'true') {
                    const blurhash = await encodeImageToBlurhash(filePath)
                    return res.send(blurhash)
                }
                break;

            default:
                break;
        }

        res.sendFile(filePath)
    }
]

const upload = multer({ storage: storage })

export {
    upload,
    getFile
}