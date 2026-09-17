'use strict';

/**
 * Módulo de Esteganografia Zero-Width (Caracteres Invisíveis)
 * Compatível com padrão Tintim / WhatsApp
 * 
 * Marcador Início/Fim: \ufeff (Zero-Width No-Break Space / BOM)
 * Bit 0:               \u200b (Zero-Width Space)
 * Bit 1:               \u200c (Zero-Width Non-Joiner)
 * Separador de chars:  \u2060 (Word Joiner)
 */

const DELIMITER = '\ufeff';
const BIT_0     = '\u200b';
const BIT_1     = '\u200c';
const SEPARATOR = '\u2060';

/**
 * Codifica um ID/UUID em uma sequência de caracteres invisíveis
 * @param {string} id - UUID ou identificador do clique
 * @returns {string} Sequência unicode invisível delimitada
 */
function encodeZeroWidth(id) {
  if (!id || typeof id !== 'string') return '';

  const chunks = [];
  for (let i = 0; i < id.length; i++) {
    const bin = id.charCodeAt(i).toString(2);
    let encodedChar = '';
    for (let b = 0; b < bin.length; b++) {
      encodedChar += (bin[b] === '1') ? BIT_1 : BIT_0;
    }
    chunks.push(encodedChar);
  }

  return DELIMITER + chunks.join(SEPARATOR) + DELIMITER;
}

/**
 * Decodifica o ID/UUID oculto em um texto, suportando dados URL-encoded (Kommo/Webhooks)
 * @param {string} rawText - Texto bruto recebido via webhook ou mensagem
 * @returns {string|null} ID/UUID decodificado ou null se não encontrado
 */
function decodeZeroWidth(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;

  let text = rawText;

  // Trata casos em que o webhook do Kommo envia o texto URL-encoded (%EF%BB%BF, etc.)
  if (text.includes('%')) {
    try {
      // Tenta decodificar até 2x caso venha duplamente encodado
      let decoded = decodeURIComponent(text);
      if (decoded.includes('%')) {
        try { decoded = decodeURIComponent(decoded); } catch (_) {}
      }
      text = decoded;
    } catch (_) {
      // Caso haja caracteres % inválidos, segue com o texto original
    }
  }

  // 1. Tenta extrair com os delimitadores originais
  let hiddenContent = null;
  const start = text.indexOf(DELIMITER);
  const end   = text.lastIndexOf(DELIMITER);

  if (start !== -1 && end !== -1 && start !== end) {
    hiddenContent = text.substring(start + DELIMITER.length, end);
  }

  // 2. Se o aplicativo / teclado móvel tiver removido o DELIMITER (\ufeff / BOM),
  // localiza diretamente a sequência contígua de caracteres invisíveis (U+200B, U+200C, U+2060)
  if (!hiddenContent) {
    const match = text.match(/[\u200b\u200c\u2060]+/);
    if (match && match[0].length >= 8) {
      hiddenContent = match[0];
    }
  }

  if (!hiddenContent) return null;

  const chunks = hiddenContent.split(SEPARATOR);
  let result = '';

  for (const chunk of chunks) {
    let bin = '';
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (ch === BIT_0) bin += '0';
      else if (ch === BIT_1) bin += '1';
    }
    if (bin) {
      const charCode = parseInt(bin, 2);
      if (!isNaN(charCode) && charCode > 0 && charCode < 65535) {
        result += String.fromCharCode(charCode);
      }
    }
  }

  return result || null;
}

/**
 * Injeta o ID invisível dentro de uma mensagem de WhatsApp
 * @param {string} message - Mensagem original visível
 * @param {string} id - UUID / ID do clique
 * @returns {string} Mensagem com o ID invisível embutido
 */
function injectHiddenId(message = '', id) {
  const invisiblePayload = encodeZeroWidth(id);
  if (!message) return invisiblePayload;

  // Se a mensagem contiver quebra de linha ou espaço, podemos injetar de forma fluida
  return message + invisiblePayload;
}

/**
 * Remove todos os caracteres invisíveis de esteganografia para exibir a mensagem limpa
 * @param {string} text - Texto com possíveis caracteres invisíveis
 * @returns {string} Texto limpo para leitura humana
 */
function cleanMessage(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(new RegExp(DELIMITER, 'g'), '')
    .replace(new RegExp(BIT_0, 'g'), '')
    .replace(new RegExp(BIT_1, 'g'), '')
    .replace(new RegExp(SEPARATOR, 'g'), '')
    .trim();
}

module.exports = {
  encodeZeroWidth,
  decodeZeroWidth,
  injectHiddenId,
  cleanMessage,
  DELIMITER,
  BIT_0,
  BIT_1,
  SEPARATOR
};
