// import path from 'path';
// import fs from 'fs';
// import bs58 from 'bs58';
// import { app } from 'electron';

// function getOutputFilePath(hash58, signature, createDirectories = false) {
//   if (!hash58) {
//     return null;
//   }

//   let directory;
//   const dataPath = path.join(app.getPath('userData'), 'lite-node-data');

//   if (signature) {
//     const signature58 = bs58.encode(signature);
//     const sig58First2Chars = signature58.substring(0, 2).toLowerCase();
//     const sig58Next2Chars = signature58.substring(2, 4).toLowerCase();
//     directory = path.join(
//       dataPath,
//       sig58First2Chars,
//       sig58Next2Chars,
//       signature58
//     );
//   } else {
//     const hash58First2Chars = hash58.substring(0, 2).toLowerCase();
//     const hash58Next2Chars = hash58.substring(2, 4).toLowerCase();
//     directory = path.join(
//       dataPath,
//       '_misc',
//       hash58First2Chars,
//       hash58Next2Chars
//     );
//   }

//   if (createDirectories) {
//     fs.mkdirSync(directory, { recursive: true });
//   }

//   return path.join(directory, hash58);
// }

// export class DataFileStore {
//   metadataHash: any;
//   secret: any;
//   dataType: any;
//   filePath: string;
//   constructor(arbitraryDataTransaction) {
//     this.secret = arbitraryDataTransaction.secret || null;
//     this.metadataHash = arbitraryDataTransaction.metadataHash || null;
//     this.dataType = arbitraryDataTransaction.dataType || null;

//     const hash58 = this.metadataHash;
//     const signature = arbitraryDataTransaction.signature || null; // should be Uint8Array or Buffer
//     this.filePath = getOutputFilePath(hash58, signature, false);
//   }

//   exists() {
//     return fs.existsSync(this.filePath);
//   }

//   allFilesExist() {
//     if (this.exists()) {
//       return true;
//     }

//     // Complete file doesn't exist, so check the chunks
//     if (this.allChunksExist()) {
//       return true;
//     }

//     return false;
//   }
// }
