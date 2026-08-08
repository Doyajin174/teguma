/**
 * 최소 XML 파서 — SVG 문서 전용.
 *
 * - 요소·속성(단일/이중 따옴표)·자체 닫힘·텍스트 노드·주석·CDATA·DOCTYPE·
 *   처리 지시문 지원.
 * - 엔티티 디코딩: &amp; &lt; &gt; &quot; &apos; &#NN; &#xHH;.
 * - 네임스페이스 프리픽스는 태그에서 제거한다 (svg:rect → rect).
 * - 외부 엔티티·DTD 로딩 없음(보안), XML 선언은 무시.
 * - 잘못된 문서는 XmlParseError로 전체 실패 (6.2 — 부분 성공 금지).
 */

export class XmlParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`SVG XML 파싱 실패 (offset ${offset}): ${message}`);
    this.name = "XmlParseError";
  }
}

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** 요소 태그 사이의 직접 텍스트 (tspan/line 분해에 사용). */
  text: string;
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return "\"";
      case "apos": return "'";
      default: return match;
    }
  });
}

interface OpenElement {
  node: XmlNode;
}

/**
 * XML 문자열 → 요소 트리. 루트가 정확히 1개여야 한다.
 */
export function parseXml(source: string): XmlNode {
  const root: XmlNode = { tag: "#document", attrs: {}, children: [], text: "" };
  const stack: OpenElement[] = [{ node: root }];
  let offset = 0;

  const appendText = (text: string): void => {
    if (text === "") return;
    stack[stack.length - 1].node.text += text;
  };

  while (offset < source.length) {
    const open = source.indexOf("<", offset);
    if (open === -1) {
      appendText(source.slice(offset));
      break;
    }
    appendText(source.slice(offset, open));

    // 주석
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end === -1) throw new XmlParseError("주석 종료(-->) 없음", open);
      offset = end + 3;
      continue;
    }
    // CDATA
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      if (end === -1) throw new XmlParseError("CDATA 종료(]]>) 없음", open);
      stack[stack.length - 1].node.text += source.slice(open + 9, end);
      offset = end + 3;
      continue;
    }
    // DOCTYPE — 내부 DTD는 건너뛴다 (외부 엔티티 로딩 금지).
    if (/^<!DOCTYPE/i.test(source.slice(open))) {
      const end = source.indexOf(">", open);
      if (end === -1) throw new XmlParseError("DOCTYPE 종료 없음", open);
      offset = end + 1;
      continue;
    }
    // 처리 지시문 / XML 선언
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end === -1) throw new XmlParseError("처리 지시문 종료(?>) 없음", open);
      offset = end + 2;
      continue;
    }
    // 닫는 태그
    if (source.startsWith("</", open)) {
      const end = source.indexOf(">", open + 2);
      if (end === -1) throw new XmlParseError("닫는 태그 종료 없음", open);
      const rawName = source.slice(open + 2, end).trim();
      const name = stripPrefix(rawName);
      const current = stack[stack.length - 1];
      if (current.node.tag !== name) {
        throw new XmlParseError(`태그 불일치: </${rawName}> (열린 태그 ${current.node.tag})`, open);
      }
      stack.pop();
      offset = end + 1;
      continue;
    }

    // 여는 태그
    const parsed = parseOpenTag(source, open);
    const tag = stripPrefix(parsed.name);
    const node: XmlNode = { tag, attrs: parsed.attrs, children: [], text: "" };
    stack[stack.length - 1].node.children.push(node);
    if (!parsed.selfClosing) {
      stack.push({ node });
    }
    offset = parsed.endOffset;
  }

  if (stack.length !== 1) {
    throw new XmlParseError(`태그가 닫히지 않음: ${stack[stack.length - 1].node.tag}`, source.length);
  }
  const children = root.children;
  if (children.length !== 1) {
    throw new XmlParseError(`루트 요소가 1개여야 합니다 (${children.length}개)`, 0);
  }
  return children[0];
}

function stripPrefix(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.slice(colon + 1);
}

interface ParsedOpenTag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
  endOffset: number;
}

function parseOpenTag(source: string, open: number): ParsedOpenTag {
  let cursor = open + 1;
  const nameStart = cursor;
  while (cursor < source.length && !/[\s/>]/.test(source[cursor])) cursor += 1;
  if (cursor === nameStart) throw new XmlParseError("태그 이름 없음", open);
  const name = source.slice(nameStart, cursor);
  const attrs: Record<string, string> = {};

  for (;;) {
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (cursor >= source.length) throw new XmlParseError("태그 종료 없음", open);
    if (source[cursor] === ">") {
      return { name, attrs, selfClosing: false, endOffset: cursor + 1 };
    }
    if (source[cursor] === "/" && source[cursor + 1] === ">") {
      return { name, attrs, selfClosing: true, endOffset: cursor + 2 };
    }
    if (source[cursor] === "/") throw new XmlParseError("잘못된 '/'", open + cursor);

    // 속성 이름
    const attrStart = cursor;
    while (cursor < source.length && !/[\s=/>]/.test(source[cursor])) cursor += 1;
    if (cursor === attrStart) throw new XmlParseError("속성 이름 없음", open + cursor);
    const attrName = source.slice(attrStart, cursor);

    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    if (source[cursor] !== "=") throw new XmlParseError(`속성 값 없음: ${attrName}`, open + cursor);
    cursor += 1;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
    const quote = source[cursor];
    if (quote !== "\"" && quote !== "'") {
      throw new XmlParseError(`속성 따옴표 없음: ${attrName}`, open + cursor);
    }
    const valueStart = cursor + 1;
    const valueEnd = source.indexOf(quote, valueStart);
    if (valueEnd === -1) throw new XmlParseError(`속성 값 종료 없음: ${attrName}`, open + cursor);
    attrs[attrName] = decodeEntities(source.slice(valueStart, valueEnd));
    cursor = valueEnd + 1;
  }
}

/** 노드의 전체 텍스트 콘텐츠 (직접 텍스트 + 자손 텍스트). */
export function textContent(node: XmlNode): string {
  if (node.children.length === 0) return node.text;
  return node.text + node.children.map(textContent).join("");
}

/** style="..." 속성 → presentation 속성 병합 (CSS 우선). */
export function styleToAttrs(node: XmlNode): Record<string, string> {
  const merged: Record<string, string> = { ...node.attrs };
  const style = node.attrs["style"];
  if (style === undefined) return merged;
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (name !== "" && value !== "") merged[name] = value;
  }
  return merged;
}
