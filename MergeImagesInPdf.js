import fs from  "fs";
import {PDFDocument} from "pdf-lib";
import sharp from "sharp";

async function imagesToPdf(imagesPaths, outputPath){
  const pdfDoc = await PDFDocument.create();
  for(const imagePath of imagesPaths){
    const imageBuffer = await sharp(imagePath).toBuffer();
    let image;
    if(imagePath.toLowerCase().endsWith(".png")){
      image = await pdfDoc.embedPng(imageBuffer);
    }else {
      image = await pdfDoc.embedJpg(imageBuffer);
    }
    const page = pdfDoc.addPage([image.width,image.height]);
    page.drawImage(image,{x:0,y:0,width:image.width,height:image.height});
  }
  const pdfBytes = await pdfDoc.save();
  fs.writeFileSync(outputPath, pdfBytes);
}

export default imagesToPdf;
