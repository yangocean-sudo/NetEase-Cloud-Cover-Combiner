const http = require('http')
const fs = require('fs')
const path = require('path')
const async = require("async")
const request = require("request")
const express = require('express')
const bodyParser = require('body-parser')
const sharp = require('sharp')
const retry = require('retry')
const looksSame = require('looks-same')
let imageSize
const imagesPath = path.join(__dirname, 'images')
const colorThief = require('color-thief-node')
const Jimp = require("jimp")
let downloadList = []

// functions
const downloadImage = (src, dest) => {
    return new Promise((resolve, reject) => {
        request.head(src, (err, res, body) => {
            if (err) {
                return reject(err)
            }
            request(src)
                .pipe(fs.createWriteStream(dest))
                .on('close', () => {
                    resolve(dest)
                })
        })
    })
}

const analyzeMainColor = async (imagePath) => {
    const mainColor = await colorThief.getColorFromURL(imagePath)
    return mainColor
}

// HSY FUNCTIONS
const rgb_to_hsY = (r, g, b) => {
    let s, h, Y
    const maxc = Math.max(r, g, b)
    const minc = Math.min(r, g, b)
    const sumc = (maxc + minc)
    const rangec = (maxc - minc)
    const l = sumc / 2.0
    h = 0.0
    Y = 0.0
    if (minc == maxc)
        return { h, l, Y }
    if (l <= 0.5)
        s = rangec / sumc
    else
        s = rangec / (2.0 - sumc)
    const rc = (maxc - r) / rangec
    const gc = (maxc - g) / rangec
    const bc = (maxc - b) / rangec
    if (r == maxc)
        h = bc - gc
    else if (g == maxc)
        h = 2.0 + rc - bc
    else
        h = 4.0 + gc - rc
    h = Math.floor((h / 6.0 + 1.0) % 1.0 * 360.0)
    Y = 0.2126 * r ** 2.2 + 0.7152 * g ** 2.2 + 0.0722 * b ** 2.2
    return { h, s, Y }
}

const calculateLuminanceFromHSY = (hsy) => {
    const luminance = hsy.Y
    return luminance
}

const get_rainbow_band = async (hue, band_deg) => {
    const rb_hue = (hue + 30) % 360
    return Math.round(rb_hue / band_deg)
}

const sortByMainColor = async (imageFiles, band_deg) => {
    const analyzedImages = await Promise.all(
        imageFiles.map(async (filename) => {
            const imagePath = path.join(imagesPath, filename)
            const mainColor = await analyzeMainColor(imagePath)
            const hsY = rgb_to_hsY(mainColor[0], mainColor[1], mainColor[2])
            const band = await get_rainbow_band(hsY.h, band_deg)
            return { filename, band, hsY }
        })
    )
    analyzedImages.sort((a, b) => {
        if (a.band != b.band) {
            return a.band - b.band
        }
        return b.hsY.Y - a.hsY.Y

    })
    return analyzedImages
}

// remove the similar images from the input list
const removeSimilarImages = async (imageList) => {
    const threshold = 0.1
    const batchSize = 2

    // loop through the list, for each image in the list, comapre it with the post five images
    // If the diff or distance is smaller than 0.1, remove the image from the list
    for (let index = 0; index < imageList.length; index++) {
        if (index >= imageList.length) {
            console.log('Image remove complete.')
            break
        }
        const image = path.join(imagesPath, imageList[index].filename)
        const imageBuffer = await Jimp.read(image)
        const batchPromises = []
        // compare the image with the next three images
        for (let i = index + 1; i < Math.min(index + batchSize + 1, imageList.length); i++) {
            const nextImage = path.join(imagesPath, imageList[i].filename)
            batchPromises.push(
                (async () => {
                    const nextImageBuffer = await Jimp.read(nextImage)
                    const distance = Jimp.distance(imageBuffer, nextImageBuffer)
                    const diffPercent = Jimp.diff(imageBuffer, nextImageBuffer).percent

                    if (distance < threshold || diffPercent < threshold) {
                        return i // Image index to remove
                    } else {
                        return -1 // No removal needed
                    }
                })()
            )
        }
        const batchResults = await Promise.all(batchPromises)

        for (const result of batchResults) {
            if (result !== -1) {
                imageList.splice(result, 1)
            }
        }

    }
    return imageList
}

const combineImagesSorted = async (imageName, band_deg, outputSize, removeCheck) => {
    try {
        const imageFiles = fs.readdirSync(imagesPath)

        let sortedImages = await sortByMainColor(imageFiles, band_deg)
        if (removeCheck) {
            console.log("Removing similar images start!")
            console.log('Number of images before removing similar images: ', sortedImages.length)
            sortedImages = await removeSimilarImages(sortedImages)
            console.log('Number of images after removing similar images: ', sortedImages.length)
        }
        // New code for adjusting combined image size
        let combinedWidthHeight = outputWidthHeight(outputSize)
        let combinedWidth = combinedWidthHeight[0]
        let combinedHeight = combinedWidthHeight[1]
        console.log(combinedWidth, combinedHeight)
        const numImages = sortedImages.length
        // print out number of images
        console.log('Number of images has downloaded: ', numImages)
        // Calculate desired image size
        const targetImageSize = Math.floor(Math.sqrt(combinedWidth * combinedHeight / numImages))
        // print out target image size
        console.log('Combing images with size: ', targetImageSize)
        // Calculate how many images per row
        // Notice: the list can't be only one image
        // TODO: Maybe create an if statement to handle this one image situation
        const imagesPerRow = Math.floor(numImages * targetImageSize / combinedWidth)
        // Calculate how many images per column
        const imagesPerColumn = Math.floor(numImages / imagesPerRow)
        // print out images per row
        console.log('Images per row: ', imagesPerRow)
        console.log('Images per column: ', imagesPerColumn)
        const combinedImage = sharp({
            create: {
                width: targetImageSize * imagesPerColumn,
                height: targetImageSize * imagesPerRow,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        })

        const compositeOperations = []
        for (let index = 0; index < numImages; index++) {
            if (index >= numImages) {
                console.log('Image compositing complete.')
                break
            }
            const row = Math.floor(index / imagesPerColumn)
            const col = index % imagesPerColumn
            const xPosition = col * targetImageSize
            const yPosition = row * targetImageSize

            const { filename } = sortedImages[index]

            const imagePath = path.join(imagesPath, filename)
            const imageBuffer = fs.readFileSync(imagePath)

            const resizedImageBuffer = await sharp(imageBuffer)
                .resize(targetImageSize, targetImageSize)
                .toBuffer()

            compositeOperations.push({
                input: resizedImageBuffer,
                top: yPosition,
                left: xPosition
            })
        }

        combinedImage.composite(compositeOperations)

        const outputImagePath = path.join(__dirname, '..', imageName + ".jpg")
        await combinedImage.toFile(outputImagePath, { quality: 100, force: true })
    } catch (error) {
        console.error('Error combining images:', error)
    }
}

// resize image function
const resizeImage = async (imageName, width, height) => {
    // resize the output Image
    const outputImagePath = path.join(__dirname, imageName + ".jpg")
    const resizedImagePath = path.join(__dirname, imageName + "_resized.jpg")
    await sharp(outputImagePath).resize({
        width: width,
        height: height,
        position: 'center',
        fit: 'cover'
    }).toFile(resizedImagePath, { quality: 100, force: true })
}
const calculateColorDistance = (color1, color2) => {
    const [r1, g1, b1] = color1
    const [r2, g2, b2] = color2
    const dr = r2 - r1
    const dg = g2 - g1
    const db = b2 - b1
    return Math.sqrt(dr * dr + dg * dg + db * db)
}

// based on the input Size string, output the width and height
const outputWidthHeight = (inputSize) => {
    // This is the html selection button
    //<option value="1290 x 2796">1290 x 2796 (suitable for some phones)</option>
    //<option value="2732 x 2048">2732 x 2048 (suitable for some Pads) </option>
    //<option value="3072 x 1920">3072 x 1920 (suitable for some Computers) </option>
    //<option value="square">Output is a square image based on your tracklist </option>
    if (inputSize === '1290 x 2796')
        return [1290, 2796]
    else if (inputSize === '2732 x 2048')
        return [2732, 2048]
    else if (inputSize === '3072 x 1920')
        return [3072, 1920]
    else if (inputSize === '1024 x 1024')
        return [1024, 1024]
    else if (inputSize === '2048 x 2048')
        return [2048, 2048]
    else
        console.log('Error: inputSize is not valid')
}
const app = express()
const port = 3001

app.use(bodyParser.json())

app.get('/', (req, res) => {
    // Serve your HTML file
    const htmlPath = path.join(__dirname, 'main_CN.html')
    fs.readFile(htmlPath, 'utf8', (err, data) => {
        if (err) {
            res.status(500).send('Error reading HTML file')
        } else {
            res.send(data)
        }
    })
})

app.post('/download', async (req) => {
    fs.mkdirSync(imagesPath, { recursive: true })
    let imageUrlNumber = req.body.imageUrl
    let imageName = req.body.imageName
    let band_deg = req.body.bandDegree
    imageSize = req.body.imageSize
    let outputSize = req.body.outputSize
    let removeCheck = req.body.removeCheck

    let imageUrl = 'http://localhost:3000/playlist/track/all?id=' + imageUrlNumber
    http.get(imageUrl, function (res) {
        let json = ''
        res.on('data', function (chunk) {
            json += chunk
        })

        res.on('end', async function () {
            try {
                const playlistData = JSON.parse(json)
                const songs = playlistData.songs
                let downloadPromises = []

                // print total number of songs
                console.log("Total number of songs:", songs.length)
                console.log("Start downloading...")
                // retry options
                const retryOptions = {
                    retries: 20, // Number of retry attempts
                    minTimeout: 10000, // Minimum delay between retries in milliseconds
                }

                for (let i = 0; i < songs.length; i++) {
                    const al = songs[i]
                    if (!downloadList.includes(al.al.picUrl)) {
                        const filename = path.basename(al.al.picUrl)
                        const dest = path.join(__dirname, 'images', filename)
                        const resizedpicUrl = al.al.picUrl + '?param=' + imageSize + 'y' + imageSize
                        downloadList.push(al.al.picUrl)
                        // Retry downloadImage function with retry options
                        const operation = retry.operation(retryOptions)
                        operation.attempt(async () => {
                            try {
                                downloadPromises.push(downloadImage(resizedpicUrl, dest))
                                // console.log('Downloading image number: ', downloadList.length)
                            } catch (err) {
                                if (operation.retry(err)) {
                                    return
                                }
                                console.error('Error downloading image: ', err)
                            }
                        })
                    }
                }
                await Promise.all(downloadPromises)
                console.log('All images downloaded successfully.')

                // clean downloadList
                downloadList = []

                await combineImagesSorted(imageName, band_deg, outputSize, removeCheck)
                console.log('Images combined successfully.')
                // delete images folder
                fs.rmSync(imagesPath, { recursive: true, force: true })
                console.log('Folder has been deleted\n--------------------------')

                // clear downloadList
                downloadPromises = []
            } catch (error) {
                console.error('Error parsing JSON: ', error)
            }
        })
    }).on('error', function (error) {
        console.error('HTTP request error:', error)
    })
})

app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})
