import { Router } from 'express'
import path from 'path'
import { 
    upload, 
    getFile,
} from '../controllers/filesControllers.js'

const router = Router()

router.post('/file', upload.single('file'), (req, res) => {
    console.log(req.file)
    res.status(200).send(path.parse(req.file!.filename).name)
})

router.get('/file/:id', getFile)

// router.put('/file/:filePath', )
// router.delete('/file/:filePath', )

export default router