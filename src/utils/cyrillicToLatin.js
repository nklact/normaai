// Serbian Cyrillic to Latin script conversion utility
// Based on official Serbian transliteration rules

const CYRILLIC_TO_LATIN_MAP = {
  // Uppercase letters
  'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Ђ': 'Đ',
  'Е': 'E', 'Ж': 'Ž', 'З': 'Z', 'И': 'I', 'Ј': 'J', 'К': 'K',
  'Л': 'L', 'Љ': 'Lj', 'М': 'M', 'Н': 'N', 'Њ': 'Nj', 'О': 'O',
  'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'Ћ': 'Ć', 'У': 'U',
  'Ф': 'F', 'Х': 'H', 'Ц': 'C', 'Ч': 'Č', 'Џ': 'Dž', 'Ш': 'Š',
  
  // Lowercase letters
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'đ',
  'е': 'e', 'ж': 'ž', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k',
  'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'ć', 'у': 'u',
  'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'č', 'џ': 'dž', 'ш': 'š'
};

/**
 * Detects if text contains Serbian Cyrillic characters
 * @param {string} text - Text to check
 * @returns {boolean} - True if Cyrillic characters are detected
 */
export function containsCyrillic(text) {
  if (!text || typeof text !== 'string') return false;
  
  // Check for any Cyrillic characters (Serbian Cyrillic range)
  const cyrillicPattern = /[а-ш]/i;
  return cyrillicPattern.test(text);
}

/**
 * Converts Serbian Cyrillic text to Latin script
 * @param {string} text - Text to convert
 * @returns {string} - Converted text in Latin script
 */
export function cyrillicToLatin(text) {
  if (!text || typeof text !== 'string') return text;
  
  // Convert character by character
  return text
    .split('')
    .map(char => CYRILLIC_TO_LATIN_MAP[char] || char)
    .join('');
}

/**
 * Converts Serbian Cyrillic to Latin if Cyrillic is detected
 * @param {string} text - Text to process
 * @returns {object} - Object with converted text and detection info
 */
export function convertIfCyrillic(text) {
  if (!text || typeof text !== 'string') {
    return {
      text: text,
      wasCyrillic: false,
      originalText: text
    };
  }
  
  const hasCyrillic = containsCyrillic(text);
  
  if (hasCyrillic) {
    return {
      text: cyrillicToLatin(text),
      wasCyrillic: true,
      originalText: text
    };
  }
  
  return {
    text: text,
    wasCyrillic: false,
    originalText: text
  };
}

// Export individual functions for specific use cases
export { CYRILLIC_TO_LATIN_MAP };