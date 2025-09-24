import fetch from "node-fetch";
import https from "https";
import {question} from "readline-sync";
import {fileURLToPath} from "url";
import {spawn} from "child_process";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import imagesToPdf from "./MergeImagesInPdf.js";

const __filename =  fileURLToPath(import.meta.url);
const __dirname = path.dirname( __filename);
const pythonBinaryPath = "/usr/bin/python3";

const tempDownloadDirectory = "/tmp/mangaDownload";
const downloadPathCacheFile = path.join(__dirname,"downloadPath");
const downloadPageBin = path.join(__dirname,"downloadPage");

let finalDestinationDir = getFinalDestinationPath();

let defaultLanguage = "en";
let displayPoints = ["",".","..","..."];
let loadingSlider = "=====================================";

let outputInterval;
const agent = new https.Agent({ family: 4 })

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve,ms));
}

function getFinalDestinationPath(){
  if(fs.existsSync(downloadPathCacheFile)){
    let fileContent = fs.readFileSync(downloadPathCacheFile,"utf-8");
    let lines = fileContent.split("\n");
    for(let line of lines){
      if(line.includes("download_path")) return line.split("=")[1].trim();
    }
  }
  return undefined;
}

function saveFinalDestination(){
  let finalDestinationInput;
  while(true){
    finalDestinationInput = question("Enter the download Directory: ");
    if(fs.existsSync(finalDestinationInput)) break;
    console.log(finalDestinationInput,"doesn't exits, please enter a valid directory");
  }
  fs.writeFileSync(downloadPathCacheFile,"download_path="+finalDestinationInput);
  return finalDestinationInput; 
}

async function getMangaId(name,attempt=0) {
  try{
    let counter = 0;
    outputInterval = setInterval(()=>{
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(`\rSearching For ${name} ${displayPoints[counter]}`);
      counter = (counter+1)%displayPoints.length;
    },500);


    let url = `https://api.mangadex.org/manga?title=${encodeURIComponent(name)}&limit=100`;
    let res = await fetch(url, { agent });
    let data = await res.json();
    clearInterval(outputInterval);
    if(!data.data.length){
      console.clear();   
      console.log(`Cannot Find a Manga Named: ${name}`);
      let SearchKeyword = question("Enter Manga Name: ");
      let res = await getMangaId(SearchKeyword);
      return res;
    }
    console.clear();

    let foundedManga = data.data.map(manga => {
      return {
        id:manga?.id,
        title:manga?.attributes?.title?.en
      }
    });
  
    console.log(`Results for ${name}:\n`);
    foundedManga.forEach((manga,index) => {
      if(index == 0)
        console.log("\x1b[1;97m%s\x1b[0m", index + "- " + manga.title);
      else
        console.log(index+"- "+manga.title);
    });

    let mangaIndex = parseInt(question("\nEnter the number of manga to download (0 by default): "));
    if(isNaN(mangaIndex)) mangaIndex = 0;

    return {
      id: foundedManga[mangaIndex]?.id,
      title: foundedManga[mangaIndex]?.title
    };
  }catch(err){
    clearInterval(outputInterval);
    if(attempt < 5){
      console.log("Error:",err.message);
      await sleep(2000);
      attempt++;
      let res = await getMangaId(name,attempt);
      return res;
    }else{
      console.log("Cannot Connect to Server, Please Check Your Internet Connection");
      return undefined;
    }
  }
}

async function getLanguage(mangaId){
  let url = `https://api.mangadex.org/manga/${mangaId}`;
  let res = await fetch(url, {agent});
  let data = await res.json();
  let defaultLanguageIndex;
  console.clear();
  let availableLanguages = data?.data?.attributes?.availableTranslatedLanguages;
  const languagesNames = new Intl.DisplayNames(["en"],{
    type:"language"
  });
  clearInterval(outputInterval);
  console.log("Available Languages:\n");
  availableLanguages?.forEach((language,index) =>{
    if(language == defaultLanguage){
      console.log("\x1b[1;97m%s\x1b[0m", index+"- "+languagesNames.of(language));
      defaultLanguageIndex = index;
    }
    else 
      console.log(index+"- "+languagesNames.of(language));
  });
  let languageIndex = parseInt(question(`\nEnter the number of the language you want (${languagesNames.of(defaultLanguage)} by default): `));
  if(isNaN(languageIndex)) languageIndex = defaultLanguageIndex;

  return availableLanguages[languageIndex];
}

async function getMangaChapters(mangaId,language){
  let chapters=[];
  let limit = 100;
  let offset = 0;
  let counter = 0;
  while(true){

    let params = {
      "translatedLanguage[]": language,
      limit: limit,
      offset: offset,
      "order[chapter]": "asc"
    };

    let url = new URL(`https://api.mangadex.org/manga/${mangaId}/feed`);
    url.search = new URLSearchParams(params).toString();
    let res = await fetch(url.toString(),{agent});
    let data = await res.json();
    if(!data.data.length) break;

    let fetchedChaptersData = data.data.map(chap =>{
      return{
        id:chap?.id,
        title:chap?.attributes.title,
        chapter_number:chap?.attributes.chapter,
      }
    });

    chapters.push(...fetchedChaptersData);
    offset += limit;
    counter += fetchedChaptersData.length;
  }
  clearInterval(outputInterval);
  let removeDuplication = [ ...new Map(chapters.map(chap => [chap.id, chap])).values() ];
  return removeDuplication;
}

async function downloadChapters(ChaptersObjs,DownloadDir,FinalDestination){
  clearInterval(outputInterval);
  if(!fs.existsSync(DownloadDir))
    fs.mkdirSync(DownloadDir,{recursive:true});
  if(!fs.existsSync(FinalDestination))
    fs.mkdirSync(FinalDestination,{recursive:true});

  let logs = [];
  let index = 0;
  let tasks = ChaptersObjs.map((chapObj,index) => {
    let pdfFinalTitle = `Chapter${chapObj.chapter_number}-${ChaptersObjs[index].title}.pdf`;
    let pdfFinalPath = path.join(FinalDestination,pdfFinalTitle);
    if(!fs.existsSync(pdfFinalPath))
      return ()=>getChapterPages(ChaptersObjs[index].id,pdfFinalPath ,DownloadDir);
    else
      return ()=>{return{status:"exist",chapter_id:ChaptersObjs[index].id, download_path:pdfFinalPath}};
  });
  for(const [index,task] of tasks.entries()){
    // fs.readdirSync(DownloadDir).forEach(file => {fs.unlinkSync(path.join(DownloadDir,file))});
    console.log(`\rDownloading Chapter ${ChaptersObjs[index].chapter_number} - ${ChaptersObjs[index].title}`);

    let res = await task();
    clearInterval(outputInterval);
    logs.push(res);
  }
  clearInterval(outputInterval);
  return logs;
}

async function downloadImagesFromSourceLink(hash, files, DownloadDir){
  let tasks = files.map((fileFromServer,index) => {
    let fileName = `${hash}-Page${index}${path.extname(fileFromServer)}`;
    return ()=>downloadImage(hash, fileFromServer, fileName, DownloadDir,files.length,index);
  });

  try{
    let results=[];
    for(const task of tasks){
      let res = await task();
      results.push(res);
    }
    return results;
    
  }catch(err){
    console.error("Download Failed:",err);
    return [];
  }
}

function downloadImage(hash, fileFromServer, fileName,DownloadDir,numberOfPages,index,attempt=0){
  return new Promise(async(res,rej)=>{
    if(!fs.existsSync(DownloadDir))
      fs.mkdirSync(DownloadDir,{recursive:true});
    
    let fileFullPath = path.join(DownloadDir,fileName);

    let fileUrl = `https://uploads.mangadex.org/data/${hash}/${fileFromServer}`;
    let DownloadProcess;
    try{
      await sharp(fileFullPath).metadata();
      DownloadProcess = spawn(pythonBinaryPath,["-c","exit(0)"],{inherite:true});
    }catch(err){
      // DownloadProcess = spawn(pythonBinaryPath,[path.join(__dirname,"downloadPage.py") ,fileUrl,DownloadDir,fileName],{inherite:true});
      DownloadProcess = spawn(downloadPageBin,[fileUrl,DownloadDir,fileName],{inherite:true});
    }
    DownloadProcess.on("close", async(code) => {
      if (code === 0) {
        // loading =====> animation 
        let FullSizeOfSlider = loadingSlider.length;
        let SizeOfSlider = (FullSizeOfSlider * index) / numberOfPages

        if(SizeOfSlider != FullSizeOfSlider){
          let Slider = loadingSlider.slice(0,SizeOfSlider);
          let whiteSpace = "                                      ";
          let sliderWhiteSpace = whiteSpace.slice(0,FullSizeOfSlider-SizeOfSlider);
          let percentage = ((SizeOfSlider*100)/FullSizeOfSlider).toFixed(2);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(`|${Slider}>${sliderWhiteSpace}|  ${percentage}%`);
        }

        res(fileFullPath);
      }else{
        process.stdout.write("\r");
        console.log("Failed to download " + fileName+", attempt:",attempt);
        if(attempt > 40) rej("failed to download " + fileFullPath);
        await sleep(2000);
        attempt++;
        downloadImage(hash, fileFromServer, fileName,DownloadDir,numberOfPages,index,attempt);
      }
    });
    DownloadProcess.on("error", err => {
      rej("failed to start download process: " + err);
    });
  })
}


async function getChapterPages(chapterId, pdfFinalPath, DownloadDir, tryNumber=0){
  try{
    clearInterval(outputInterval);
    let url = `https://api.mangadex.org/at-home/server/${chapterId}`;
    let res = await fetch(url,{agent});
    let data = await res.json();
    let hash = data.chapter?.hash;
    let files = data.chapter?.data;

    let paths = await downloadImagesFromSourceLink(hash, files, DownloadDir);
    await imagesToPdf(paths,pdfFinalPath);
    paths.forEach(file => {fs.unlinkSync(file)});
    console.clear();
    return {status:"succeed",chapter_id:chapterId, download_path:pdfFinalPath};
  }catch(error){
    console.log("\nDownload Failed");
    console.error(error.message);
    await sleep(2000);
    if(tryNumber > 2)
      return {status:"failed",chapter_id:chapterId, download_path:pdfFinalPath};
    tryNumber++;
    let res = await getChapterPages(chapterId, pdfFinalPath, DownloadDir, tryNumber);
    return res;
  }
}

async function DownloadManga(name){
  console.clear();
  let counter = 0;
  let SearchedManga = await getMangaId(name);
  if(SearchedManga == undefined) return;
  let mangaId = SearchedManga.id;
  let mangaTitle = SearchedManga.title;

  console.clear();
  outputInterval = setInterval(()=>{
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write("\rLoading languages "+displayPoints[counter]);
    counter = (counter+1)%displayPoints.length;
  },500);

  let Language = await getLanguage(mangaId);

  console.clear();

  if (finalDestinationDir == undefined) finalDestinationDir = await saveFinalDestination();

  console.clear();
  outputInterval = setInterval(()=>{
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write("\rGetting Chapters Information "+displayPoints[counter]);
    counter = (counter+1)%displayPoints.length;
  },500);


  let ChaptersObjs = await getMangaChapters(mangaId, Language);
  console.clear();
  console.log("Number of Chapters Founded:", ChaptersObjs.length);

  let downloadAll = await question("Do you want to Download All the Chapters?(Y/n): ");
  if(downloadAll.toString().toLowerCase().includes("n")){
    let fromChap;
    let toChap;
    while(true){
      fromChap = parseInt(await question("From: "));
      toChap = parseInt(await question("To: "));

      if((0 <= fromChap  && fromChap < ChaptersObjs.length) &&
        (0 <= toChap  && toChap < ChaptersObjs.length) &&
        (fromChap <= toChap))
      {

        if(fromChap == toChap)
          ChaptersObjs =  [ChaptersObjs[fromChap]];
        else
          ChaptersObjs = ChaptersObjs.slice(fromChap,toChap+1);

        break;
      }
      else{
        console.clear();
        console.log("the segment you provide is not valid, please try again");
      }
    }
  }
  clearInterval(outputInterval);
  console.clear();
  outputInterval = setInterval(()=>{
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write("\rDownloading Chapters "+displayPoints[counter]);
    counter = (counter+1)%displayPoints.length;
  },500);

  let MangaTemporaryDownloadDirectory = path.join(tempDownloadDirectory,mangaTitle);
  let MangaFinalDestination = path.join(finalDestinationDir,mangaTitle);

  let chaptersDownoadLogs = await downloadChapters(ChaptersObjs,MangaTemporaryDownloadDirectory,MangaFinalDestination);
  console.log();
  chaptersDownoadLogs.forEach(chapLog=>{
    if(chapLog.status  == "exist") console.loc(`"${chapLog.download_path}" already exist.`);
    else console.log(`"${chapLog.download_path}" Download was ${chapLog.status}`);
  });
}

let SearchKeyword = question("Enter Manga Name: ");
DownloadManga(SearchKeyword);
