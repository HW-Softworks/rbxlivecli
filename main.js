const fs = require('fs');
const path = require('path');
const cliProgress = require('cli-progress');
const { exit } = require('process');
const axios = require('axios');

const downloadFile = require('./modules/download');
const verifyChecksum = require('./modules/checksum');
const extractZip = require('./modules/extract');
const fetchVersion = require('./modules/version');
const { deleteFolderRecursive } = require('./modules/fileutils');
const { folderMappings, AppSettings } = require('./modules/constants');
const logger = require('./modules/logger');
const fetchPreviousVersion = require('./modules/fpv');

const CONFIG_FILE_PATH = './config.json';
const DEFAULT_CONFIG = {
  deleteExistingFolders: false,
  forceUpdate: false,
};

let config = { ...DEFAULT_CONFIG };

const colors = {
  RESET: "\x1b[0m",
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  BLUE: "\x1b[34m",
  MAGENTA: "\x1b[35m",
  CYAN: "\x1b[36m",
};

const clearTerminal = () => {
  console.clear();
};

const asciiArt = `
▄▄▄  ▄▄▄▄· ▐▄• ▄ ▄▄▌  ▪   ▌ ▐·▄▄▄ . ▄▄· ▄▄▌  ▪  
▀▄ █·▐█ ▀█▪ █▌█▌▪██•  ██ ▪█·█▌▀▄.▀·▐█ ▌▪██•  ██ 
▐▀▀▄ ▐█▀▀█▄ ·██· ██▪  ▐█·▐█▐█•▐▀▀▪▄██ ▄▄██▪  ▐█·
▐█•█▌██▄▪▐█▪▐█·█▌▐█▌▐▌▐█▌ ███ ▐█▄▄▌▐███▌▐█▌▐▌▐█▌
.▀  ▀·▀▀▀▀ •▀▀ ▀▀.▀▀▀ ▀▀▀. ▀   ▀▀▀ ·▀▀▀ .▀▀▀ ▀▀▀ v1.0.4                                                                                            
Download and launch Roblox versions using just the command line.
`;

const mainMenu = `
${asciiArt}
${colors.GREEN}1. Download latest version/update${colors.RESET}
${colors.YELLOW}2. Download the last LIVE version (downgrade)${colors.RESET}
${colors.CYAN}3. Download a custom version hash${colors.RESET}
${colors.MAGENTA}4. Settings${colors.RESET}
${colors.RED}5. Exit${colors.RESET}
`;

const loadConfig = () => {
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    const rawData = fs.readFileSync(CONFIG_FILE_PATH);
    config = JSON.parse(rawData);
  } else {
    saveConfig();
  }
};

const saveConfig = () => {
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(config, null, 2));
};

const showSettingsMenu = async () => {
  clearTerminal();
  console.log(`${colors.MAGENTA}Settings Menu${colors.RESET}`);
  console.log(`${colors.GREEN}1. Toggle delete existing folders (Current: ${config.deleteExistingFolders})${colors.RESET}`);
  console.log(`${colors.YELLOW}2. Toggle force update (Current: ${config.forceUpdate})${colors.RESET}`);
  console.log(`${colors.RED}3. Back to main menu${colors.RESET}`);
  const choice = await prompt('Select an option: ');

  switch (choice) {
    case '1':
      config.deleteExistingFolders = !config.deleteExistingFolders;
      console.log(`${colors.BLUE}Delete existing folders set to: ${config.deleteExistingFolders}${colors.RESET}`);
      saveConfig();
      await prompt('Press Enter to continue...');
      showSettingsMenu();
      break;
    case '2':
      config.forceUpdate = !config.forceUpdate;
      console.log(`${colors.BLUE}Force update set to: ${config.forceUpdate}${colors.RESET}`);
      saveConfig();
      await prompt('Press Enter to continue...');
      showSettingsMenu();
      break;
    case '3':
      main();
      break;
    default:
      console.log(colors.RED + 'Invalid option selected. Please try again.' + colors.RESET);
      showSettingsMenu();
      break;
  }
};

const main = async () => {
  clearTerminal();
  console.log(mainMenu);
  const choice = await prompt('Select an option: ');

  switch (choice) {
    case '1':
      clearTerminal();
      await downloadLatestVersion();
      break;
    case '2':
      clearTerminal();
      const previousVersion = await fetchPreviousVersion();
      if (previousVersion) {
        await downloadVersion(previousVersion);
      }
      break;
    case '3':
      clearTerminal();
      const versionHash = await prompt('Enter the custom version hash: ');
      await downloadCustomVersion(versionHash);
      break;
    case '4':
      clearTerminal();
      await showSettingsMenu();
      break;
    case '5':
      clearTerminal();
      console.log(colors.BLUE + 'Exiting...' + colors.RESET);
      exit(0);
      break;
    default:
      clearTerminal();
      console.log(colors.RED + 'Invalid option selected. Please try again.' + colors.RESET);
      main();
      break;
  }
};

const downloadLatestVersion = async () => {
  logger.info('Fetching the latest version of Roblox from LIVE Channel...');
  logger.info('--> https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer/channel/live/');
  const version = await fetchVersion();
  logger.info(`Version: ${version}`);

  await downloadVersion(version);
};

const downloadCustomVersion = async (version) => {
  logger.info(`Fetching the custom version: ${version}`);

  await downloadVersion(version);
};

const downloadVersion = async (version) => {
  clearTerminal();
  const versionFolder = version.startsWith('version-') ? version : `version-${version}`;
  const dumpDir = path.join(__dirname, versionFolder);

  if (fs.existsSync(dumpDir) && !config.forceUpdate) {
    logger.info(`Version ${version} is already downloaded.`);
    exit(0);
  }

  if (fs.existsSync(dumpDir) && config.deleteExistingFolders) {
    logger.info(`Deleting existing folder: ${dumpDir}`);
    deleteFolderRecursive(dumpDir);
  }

  const baseUrl = `https://setup.rbxcdn.com/${version}-`;
  const manifestUrl = `${baseUrl}rbxPkgManifest.txt`;

  fs.mkdirSync(dumpDir, { recursive: true });
  logger.info(`Fetching manifest from ${manifestUrl}...`);
  const response = await axios.get(manifestUrl);
  const manifestContent = response.data.trim().split('\n');

  const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);

  for (let i = 1; i < manifestContent.length; i += 4) {
    const fileName = manifestContent[i].trim();
    const checksum = manifestContent[i + 1].trim();
    const compressedSize = parseInt(manifestContent[i + 2], 10);
    const uncompressedSize = parseInt(manifestContent[i + 3], 10);

    if (fileName.endsWith('.zip') || fileName.endsWith('.exe')) {
      const packageUrl = `${baseUrl}${fileName}`;
      const filePath = `${dumpDir}/${fileName}`;

      logger.info(`Downloading ${fileName} from ${packageUrl}...`);
      await downloadFile(packageUrl, filePath, progressBar);

      logger.info(`Verifying ${fileName}...`);
      const isChecksumValid = await verifyChecksum(filePath, checksum);

      if (isChecksumValid) {
        logger.info(`${fileName} downloaded and verified successfully.`);
        if (fileName.endsWith('.zip')) {
          logger.info(`Extracting ${fileName}...`);
          const extractPath = await extractZip(filePath, dumpDir, folderMappings);
          logger.info(`Cleaning up ${fileName}...`);
          fs.unlinkSync(filePath);
          logger.info(`Deleted ${fileName}.`);
        }
      } else {
        logger.error(`Checksum mismatch for ${fileName}. Deleting file.`);
        fs.unlinkSync(filePath);
      }
    } else {
      logger.info(`Skipping entry: ${fileName}`);
    }
  }

  logger.info(`Creating AppSettings.xml...`);
  fs.writeFileSync(`${dumpDir}/AppSettings.xml`, AppSettings);
  logger.info(`AppSettings.xml created at root.`);

  logger.info(`Roblox ${version} has been successfully downloaded and extracted to ${dumpDir}.`);
  exit(0);
};

const prompt = (query) => {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
};

loadConfig();
main().catch(err => logger.error(err));
