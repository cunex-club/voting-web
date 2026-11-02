import { QUESTION_TYPES, type PollDraftInput } from './poll-draft.schema.js';

export interface Problem {
  path: string;
  message: string;
}

/**
 * Checks a draft is ready for review. Drafts may be saved half-done; this is
 * the gate before POST /polls/:id/submit. Returns every problem at once so the
 * editor can highlight all of them.
 */
export function findProblems(draft: PollDraftInput, now: Date): Problem[] {
  const problems: Problem[] = [];
  const add = (path: string, message: string) =>
    problems.push({ path, message });

  if (!draft.title) add('title', 'ต้องมีชื่อโพล');
  if (!draft.closesAt) {
    add('closesAt', 'ต้องกำหนดเวลาปิดโหวต');
  } else if (new Date(draft.closesAt) <= now) {
    add('closesAt', 'เวลาปิดโหวตต้องอยู่ในอนาคต');
  }
  if (
    draft.audience.type === 'restricted' &&
    draft.audience.rules.length === 0
  ) {
    add('audience.rules', 'ต้องเลือกคณะหรือปีเข้าอย่างน้อย 1 อย่าง');
  }
  if (draft.audience.type === 'codes' && draft.audience.codes.length === 0) {
    add('audience.codes', 'ต้องใส่รหัสอย่างน้อย 1 รหัส');
  }
  if (
    draft.opensAt &&
    draft.closesAt &&
    new Date(draft.opensAt) >= new Date(draft.closesAt)
  ) {
    add('opensAt', 'เวลาเปิดโหวตต้องอยู่ก่อนเวลาปิดโหวต');
  }

  const elements = draft.elements;
  if (!elements.some((e) => QUESTION_TYPES.has(e.type))) {
    add('elements', 'ต้องมีคำถามอย่างน้อย 1 ข้อ');
  }
  if (elements.at(0)?.type === 'page_break') {
    add('elements.0', 'ขึ้นหน้าใหม่ต้องไม่อยู่บนสุด');
  }
  if (elements.length > 0 && elements.at(-1)?.type === 'page_break') {
    add(`elements.${elements.length - 1}`, 'ขึ้นหน้าใหม่ต้องไม่อยู่ล่างสุด');
  }

  elements.forEach((e, i) => {
    const at = `elements.${i}`;
    if (e.type === 'page_break' && elements[i + 1]?.type === 'page_break') {
      add(at, 'ขึ้นหน้าใหม่ซ้อนกัน 2 ครั้ง');
    }
    if (QUESTION_TYPES.has(e.type) && 'title' in e && !e.title) {
      add(`${at}.title`, 'ต้องมีคำถาม');
    }
    if ('options' in e) {
      if (e.options.length < 2)
        add(`${at}.options`, 'ต้องมีตัวเลือกอย่างน้อย 2 ข้อ');
      e.options.forEach((o, j) => {
        if (!o.label) add(`${at}.options.${j}.label`, 'ต้องมีข้อความตัวเลือก');
        if (o.popup && (!o.popup.title || !o.popup.body)) {
          add(`${at}.options.${j}.popup`, 'ต้องมีทั้งหัวข้อและเนื้อหา');
        }
      });
    }
    if (e.type === 'image' && !e.config.url) {
      add(`${at}.config.url`, 'ต้องอัปโหลดรูป');
    }
    if (e.type === 'info_popup' || e.type === 'accordion') {
      if (!e.config.title) add(`${at}.config.title`, 'ต้องมีหัวข้อ');
      if (!e.config.body) add(`${at}.config.body`, 'ต้องมีเนื้อหา');
    }
    if (e.type === 'multi_choice') {
      const { minSelect, maxSelect } = e.config;
      if (minSelect !== undefined && minSelect > e.options.length) {
        add(`${at}.config.minSelect`, 'เลือกขั้นต่ำมากกว่าจำนวนตัวเลือก');
      }
      if (maxSelect !== undefined && maxSelect > e.options.length) {
        add(`${at}.config.maxSelect`, 'เลือกได้สูงสุดมากกว่าจำนวนตัวเลือก');
      }
    }
    if (e.type === 'description') {
      e.config.sections.forEach((s, j) => {
        if (!s.body && !s.heading) {
          add(`${at}.config.sections.${j}.body`, 'ต้องมีหัวข้อหรือเนื้อหา');
        }
      });
    }
  });

  return problems;
}
