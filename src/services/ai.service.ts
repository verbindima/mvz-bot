import { injectable } from 'tsyringe';
import { GoogleGenAI } from '@google/genai';
import { CONFIG } from '@/config';
import { logger } from '@/utils/logger';

@injectable()
export class AIService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({
      apiKey: CONFIG.GEMINI_API_KEY,
    });
  }

  async generateResponse(message: string): Promise<string> {
    try {
      if (!CONFIG.GEMINI_API_KEY) {
        return 'AI недоступен: не настроен GEMINI_API_KEY';
      }

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: message,
      });

      return response.text || 'AI не смог сгенерировать ответ';
    } catch (error) {
      logger.error('Error generating AI response:', error);
      return 'Произошла ошибка при обращении к AI';
    }
  }
}