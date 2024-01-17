import multer from 'multer'
import { NextFunction, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { ctl } from '../../server.js'
import sharp from 'sharp'
import { encode } from 'blurhash'
import { param, query } from 'express-validator'

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/')
    },
    filename: async (req, file, cb) => {
        const fileID = await ctl.createFile(req.user.userID, 'avatar')
        cb(null, fileID + path.extname(file.originalname))
    }
})

function encodeImageToBlurhash(path: string) {
    if (!fs.existsSync(path)) {
        console.error('Error: File does not exist:', path)
        return ''
    }
    return new Promise((resolve, reject) => {
        sharp(path)
            .raw()
            .ensureAlpha()
            .resize(32, 32, { fit: 'inside' })
            .toBuffer((err, buffer, { width, height }) => {
                if (err) return reject(err)
                resolve(encode(new Uint8ClampedArray(buffer), width, height, 4, 4))
            })
    })
}

const getImage = [
    param('filePath').notEmpty().withMessage('需要 filePath'),
    query('blurhash').optional().isString().isIn(['true', 'false']).withMessage('blurhash 可選 true'),
    async (req: Request, res: Response) => {
        const { filePath } = req.params
        const imagePath = path.join(process.cwd(), '/uploads', filePath)
    
        if (req.query.blurhash === 'true') {
            const blurhash = await encodeImageToBlurhash(imagePath)
            return res.send(blurhash)
        }
    
        console.log(imagePath)
        res.sendFile(imagePath)
    }
]

const upload = multer({ storage: storage })

export {
    upload,
    getImage
}