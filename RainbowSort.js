const http = require('http')
const fs = require('fs')
const path = require('path')
const async = require("async")
const request = require("request")
const express = require('express')
const bodyParser = require('body-parser')
const sharp = require('sharp')
const retry = require('retry')
let imageSize
const imagesPath = path.join(__dirname, 'images')
const outputImagePath = path.join(__dirname, 'combined.jpg')
const colorThief = require('color-thief-node')
let downloadList = []
// fs.mkdirSync(imagesPath, { recursive: true })

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
        });
    });
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
            // console.log(filename, band)
            // console.log(filename, hsY.h)
            return { filename, band, hsY }
        })
    )
    analyzedImages.sort((a, b) => {
        // // Compare main colors for sorting using Euclidean distance
        // const distanceA = calculateColorDistance(a.mainColor, [255, 255, 255]) // Compare to white [255, 255, 255]
        // const distanceB = calculateColorDistance(b.mainColor, [255, 255, 255])
        // return distanceA - distanceB

        // const greyA = (a.mainColor[0] * 0.2126 + a.mainColor[1] * 0.7152 + a.mainColor[2] * 0.0722)
        // const greyB = (b.mainColor[0] * 0.2126 + b.mainColor[1] * 0.7152 + b.mainColor[2] * 0.0722)
        // return greyB - greyA
        if (a.band != b.band) {
            return a.band - b.band
        }
        return b.hsY.Y - a.hsY.Y

    })
    return analyzedImages
}

const combineImagesSorted = async (imageName, band_deg) => {
    try {
        const imageFiles = fs.readdirSync(imagesPath)
        const sortedImages = await sortByMainColor(imageFiles, band_deg)

        // New code for adjusting combined image size
        const combinedWidth = 3072
        const combinedHeight = 1920
        const numImages = sortedImages.length
        // print out number of images
        console.log('Number of images: ', numImages)
        // Calculate desired image size
        const targetImageSize = Math.floor(Math.sqrt(combinedWidth * combinedHeight / numImages))
        // print out target image size
        console.log('Target image size: ', targetImageSize)
        // Calculate how many images per row
        const imagesPerRow = Math.floor(numImages * targetImageSize / combinedWidth)
        // Calculate how many images per column
        const imagesPerColumn = Math.floor(numImages / imagesPerRow)
        // print out images per row
        console.log('Images per row: ', imagesPerRow)
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
            // console.log('Row: ', row, 'Col: ', col)
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


        // const gridSize = Math.floor(Math.sqrt(sortedImages.length)); // Number of images in each row and column
        // const combinedSize = gridSize * imageSize

        // // Create a new image with white background
        // const combinedImage = sharp({
        //     create: {
        //         width: combinedSize,
        //         height: combinedSize,
        //         channels: 3,
        //         background: { r: 255, g: 255, b: 255 }
        //     }
        // })

        // const compositeOperations = [];
        // sortedImages.forEach(({ filename }, index) => {
        //     if (index >= gridSize * gridSize) {
        //         console.log('Image compositing complete.')
        //         return
        //     }
        //     const row = Math.floor(index / gridSize)
        //     const col = index % gridSize
        //     const imagePath = path.join(imagesPath, filename)
        //     const imageBuffer = fs.readFileSync(imagePath)
        //     compositeOperations.push({
        //         input: imageBuffer,
        //         top: row * imageSize,
        //         left: col * imageSize
        //     })
        // })

        await combinedImage.composite(compositeOperations)

        const outputImagePath = path.join(__dirname, imageName + ".jpg")
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

const app = express()
const port = 3001

app.use(bodyParser.json())

app.get('/', (req, res) => {
    // Serve your HTML file
    const htmlPath = path.join(__dirname, 'test.html')
    fs.readFile(htmlPath, 'utf8', (err, data) => {
        if (err) {
            res.status(500).send('Error reading HTML file')
        } else {
            res.send(data)
        }
    })
})

app.post('/download', async (req, res) => {
    fs.mkdirSync(imagesPath, { recursive: true })
    let imageUrlNumber = req.body.imageUrl
    let imageName = req.body.imageName
    let band_deg = req.body.bandDegree
    imageSize = req.body.imageSize
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

                // retry options
                const retryOptions = {
                    retries: 20, // Number of retry attempts
                    minTimeout: 10000, // Minimum delay between retries in milliseconds
                };

                for (let i = 0; i < songs.length; i++) {
                    const al = songs[i]
                    if (!downloadList.includes(al.al.picUrl)) {
                        const filename = path.basename(al.al.picUrl)
                        const dest = path.join(__dirname, 'images', filename)
                        const resizedpicUrl = al.al.picUrl + '?param=' + imageSize + 'y' + imageSize
                        downloadList.push(al.al.picUrl)
                        // Retry downloadImage function with retry options
                        const operation = retry.operation(retryOptions);
                        operation.attempt(async (currentAttempt) => {
                            try {
                                downloadPromises.push(downloadImage(resizedpicUrl, dest))
                                console.log('Downloading image number: ', downloadList.length)
                            } catch (err) {
                                if (operation.retry(err)) {
                                    return;
                                }
                                console.error('Error downloading image: ', err);
                            }
                        });
                    }
                }
                await Promise.all(downloadPromises)
                console.log('All images downloaded successfully.')

                // clean downloadList
                downloadList = []

                await combineImagesSorted(imageName, band_deg)
                console.log('Images combined successfully.')
                // await resizeImage(imageName, 1080, 1920)
                console.log('Images resized successfully.')
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

    // res.json({ message: 'Image downloaded and processed successfully.' })
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
