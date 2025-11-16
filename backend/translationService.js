const fs = require("fs");
const fsp = require("fs").promises;
const sdk = require("microsoft-cognitiveservices-speech-sdk");
const axios = require("axios");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

require("dotenv").config();

const { OpenAI } = require("openai");

class TranslationService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.speechKey = process.env.AZURE_SPEECH_KEY;
    this.speechRegion = process.env.AZURE_SPEECH_REGION;

    this.azureTranslateKey = process.env.AZURE_TRANSLATE_KEY;
    this.azureTranslateRegion = process.env.AZURE_TRANSLATE_REGION;
  }

  // Convert WebM → WAV
  convertWebMToWav(input, output) {
    return new Promise((resolve, reject) => {
      console.log(`🔄 Converting ${input} to WAV...`);

      ffmpeg(input)
        .inputOptions(["-loglevel", "error"])
        .outputOptions(["-acodec", "pcm_s16le", "-ac", "1", "-ar", "16000"])
        .toFormat("wav")
        .on("start", (cmd) => {
          console.log(`📝 FFmpeg: ${cmd}`);
        })
        .on("end", () => {
          console.log(`✅ Conversion complete`);
          resolve(output);
        })
        .on("error", (err) => {
          console.error(`❌ FFmpeg error: ${err.message}`);
          reject(err);
        })
        .save(output);
    });
  }

  // Whisper STT
  async transcribeWhisper(wavPath, language = "et") {
    try {
      console.log(`🧠 Whisper STT: transcribing ${language}...`);

      const result = await this.openai.audio.transcriptions.create({
        model: "whisper-1",
        file: fs.createReadStream(wavPath),
        language: language,
      });

      console.log(`✅ Transcription: "${result.text}"`);
      return result.text;
    } catch (error) {
      console.error("❌ Whisper error:", error.message);
      return "";
    }
  }

  // Azure Text Translation
  async translateTextAzure(text, fromLang, toLang) {
    try {
      console.log(`🌐 Translating: "${text}" (${fromLang} → ${toLang})`);

      const response = await axios.post(
        `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${fromLang}&to=${toLang}`,
        [{ Text: text }],
        {
          headers: {
            "Ocp-Apim-Subscription-Key": this.azureTranslateKey,
            "Ocp-Apim-Subscription-Region": this.azureTranslateRegion,
            "Content-Type": "application/json",
          },
        }
      );

      const translated = response.data[0].translations[0].text;
      console.log(`✅ Translated: "${translated}"`);
      return translated;
    } catch (err) {
      console.error(
        "❌ Azure translation error:",
        err.response?.data || err.message
      );
      return text;
    }
  }

  // Azure Neural TTS
  async synthesizeSpeech(
    text,
    outputFile = "translated_output.mp3",
    language = "en"
  ) {
    try {
      console.log(`🎤 Azure Neural TTS: "${text}" (${language})`);

      const speechConfig = sdk.SpeechConfig.fromSubscription(
        this.speechKey,
        this.speechRegion
      );

      const voices = {
        en: "en-US-JennyNeural",
        et: "et-EE-AnuNeural",
        es: "es-ES-ElviraNeural",
        de: "de-DE-KatjaNeural",
      };

      speechConfig.speechSynthesisVoiceName =
        voices[language] || "en-US-JennyNeural";
      speechConfig.speechSynthesisOutputFormat =
        sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

      const audioConfig = sdk.AudioConfig.fromAudioFileOutput(outputFile);
      const synthesizer = new sdk.SpeechSynthesizer(speechConfig, audioConfig);

      return new Promise((resolve, reject) => {
        synthesizer.speakTextAsync(
          text,
          (result) => {
            synthesizer.close();
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              console.log(`✅ Azure Neural TTS complete!`);
              resolve(outputFile);
            } else {
              console.error(`❌ TTS failed: ${result.errorDetails}`);
              reject(result.errorDetails);
            }
          },
          (error) => {
            synthesizer.close();
            reject(error);
          }
        );
      });
    } catch (error) {
      console.error(`❌ Azure TTS error:`, error.message);
      return "";
    }
  }

  // Full Pipeline: Audio (sourceLang) → Translated Audio (targetLang)
  async fullPipeline(inputWebm, sourceLang = "et", targetLang = "en") {
    try {
      console.log(`🚀 Starting ${sourceLang} → ${targetLang} pipeline`);

      // Check file size
      const stats = await fsp.stat(inputWebm);
      console.log(`📁 Input: ${stats.size} bytes`);

      if (stats.size < 1000) {
        console.error("❌ Audio too small!");
        return "";
      }

      const wavPath = inputWebm + ".wav";

      // Step 1: Convert WebM to WAV
      await this.convertWebMToWav(inputWebm, wavPath);

      // Step 2: Whisper STT (transcribe in source language)
      const transcribedText = await this.transcribeWhisper(wavPath, sourceLang);
      if (!transcribedText) {
        await fsp.unlink(wavPath).catch(() => {});
        return "";
      }

      // Step 3: Translate (sourceLang → targetLang)
      const translatedText = await this.translateTextAzure(
        transcribedText,
        sourceLang,
        targetLang
      );

      // Step 4: TTS (synthesize in target language)
      const outputMp3 = await this.synthesizeSpeech(
        translatedText,
        "translated_output.mp3",
        targetLang
      );

      // Cleanup
      await fsp.unlink(wavPath).catch(() => {});

      return outputMp3;
    } catch (error) {
      console.error("❌ Pipeline error:", error);
      return "";
    }
  }
}

module.exports = TranslationService;