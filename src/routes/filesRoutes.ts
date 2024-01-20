import { Router } from 'express'
import { 
    upload, 
    getImage
} from '../controllers/filesControllers.js'

import { ctl } from '../../server.js'

const router = Router()

router.post('/file', upload.single('file'), (req, res) => {
    console.log(req.file, req.body)
    res.status(200).send(`file/${req.file?.filename}`)
})

router.get('/file/:filePath', getImage)

// router.put('/file/:filePath', )
// router.delete('/file/:filePath', )

export default router