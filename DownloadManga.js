import fetch from "node-fetch";
import https from "https";
import {question} from "readline-sync";
import {fileURLToPath} from "url";
import path from "path";
import fs from "fs";

const __filename =  fileURLToPath(import.meta.url);
const __dirname = path.dirname( __filename);

const tempDownloadDirectory = "/tmp/mangaDownload";
const downloadPathCacheFile = path.join(__dirname,"downloadPath");
let finalDestinationDir = getFinalDestinationPath();

const agent = new https.Agent({ family: 4 })

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

async function getMangaId(name) {
  let url = `https://api.mangadex.org/manga?title=${encodeURIComponent(name)}&limit=100`;
  let res = await fetch(url, { agent });
  let data = await res.json();
  let foundedManga = data.data.map(manga => {
    return {
      id:manga?.id,
      title:manga?.attributes?.title?.en
    }
  });
  foundedManga.forEach((manga,index) => {
    console.log(index+"- "+manga.title);
  });

  let mangaIndex = parseInt(question("\nEnter the number of manga to download: "));
  return {
    id: foundedManga[mangaIndex]?.id,
    title: foundedManga[mangaIndex]?.title
  };
}

async function getLanguage(mangaId){
  let url = `https://api.mangadex.org/manga/${mangaId}`;
  let res = await fetch(url, {agent});
  let data = await res.json();
  console.clear();
  let availableLanguages = data?.data?.attributes?.availableTranslatedLanguages;
  const languagesNames = new Intl.DisplayNames(["en"],{
    type:"language"
  });
  console.log("Available Languages:\n");
  availableLanguages?.forEach((language,index) =>{
    console.log(index+"- "+languagesNames.of(language));
  });
  let languageIndex = parseInt(question("\nEnter the number of the language you want: "));
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
  let removeDuplication = [ ...new Map(chapters.map(chap => [chap.id, chap])).values() ];
  return removeDuplication;
}
async function downloadChapters(ChaptersObjs,DownloadDir){
  if(!fs.existsSync(DownloadDir))
    fs.mkdirSync(DownloadDir,{recursive:true});
  let logs = [];
  ChaptersObjs.forEach(async(chapObj) => {
      let res = await getChapterPages(chapObj.id,chapObj.title);
      // logs.push(res);
  });
}

async function getChapterPages(chapterId, chapterTitle, tryNumber=0){
  try{
    let url = `https://api.mangadex.org/at-home/server/${chapterId}`;
    let res = await fetch(url,{agent});
    let data = await res.json();
    console.log(data);
    return {status:"success",chapter_id:chapterId,chapter_title:chapterTitle, download_path:downloadPath};
  }catch(error){
    if(tryNumber > 10) return {status:"failure",chapter_id:chapterId,chapter_title:chapterTitle};
    tryNumber++;
    getChapterPages(chapterId, chapterTitle, tryNumber);
  }
}

async function DownloadManga(name){
  let SearchedManga = await getMangaId(name);
  let mangaId = SearchedManga.id;
  let mangaTitle = SearchedManga.title;
  console.clear();
  console.log("loading ...");

  let Language = await getLanguage(mangaId);
  console.clear();
  console.log("getting Chapters Information ...");

  let ChaptersObjs = await getMangaChapters(mangaId, Language);

  if (finalDestinationDir == undefined) finalDestinationDir = await saveFinalDestination();

  let MangaTemporaryDownloadDirectory = path.join(tempDownloadDirectory,mangaTitle);
  await downloadChapters(ChaptersObjs,MangaTemporaryDownloadDirectory);

  let MangaFinalDestination = path.join(finalDestinationDir,FinalDestination);
  await moveChaptersToFinalDestination(MangaTemporaryDownloadDirectory, MangaFinalDestination);
}

// saveFinalDestination();

DownloadManga("berserk");
