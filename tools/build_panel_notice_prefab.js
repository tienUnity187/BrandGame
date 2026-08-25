/**
 * Tạo panel_notice.prefab hợp lệ từ panel_lose.prefab (Cocos deserialize OK).
 * Chạy: node tools/build_panel_notice_prefab.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'resources', 'prefabs', 'ui', 'panel_lose.prefab');
const OUT = path.join(ROOT, 'assets', 'resources', 'prefabs', 'ui', 'panel_notice.prefab');
const NOTICE_SCRIPT_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FAILED_SCRIPT_TYPE = '6eafdkfxMRHeajZoeOjNb0y';

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

/** Cocos Creator compressHex(uuid without dashes, reservedHeadLength=5) */
function compressUuid(fullUuid) {
  const hex = fullUuid.replace(/-/g, '');
  if (hex.length !== 32) return fullUuid;
  const reservedHeadLength = 5;
  let i = reservedHeadLength;
  const head = hex.slice(0, i);
  const base64Chars = [];
  while (i < hex.length) {
    const h1 = parseInt(hex[i], 16);
    const h2 = parseInt(hex[i + 1], 16);
    const h3 = parseInt(hex[i + 2], 16);
    base64Chars.push(BASE64_KEYS[(h1 << 2) | (h2 >> 2)]);
    base64Chars.push(BASE64_KEYS[((h2 & 3) << 4) | h3]);
    i += 3;
  }
  return head + base64Chars.join('');
}

function pushCompInfo(data, fileId) {
  const id = data.length;
  data.push({ __type__: 'cc.CompPrefabInfo', fileId });
  return id;
}

function pushLabel(data, nodeId, text, fontSize, color, wrap, height, filePrefix) {
  const infoId = pushCompInfo(data, `${filePrefix}Info`);
  const labelId = data.length;
  data.push({
    __type__: 'cc.Label',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: infoId },
    _customMaterial: null,
    _srcBlendFactor: 2,
    _dstBlendFactor: 4,
    _color: { __type__: 'cc.Color', ...color },
    _string: text,
    _horizontalAlign: 1,
    _verticalAlign: 1,
    _actualFontSize: fontSize,
    _fontSize: fontSize,
    _fontFamily: 'Arial',
    _lineHeight: fontSize + (wrap ? 8 : 6),
    _overflow: wrap ? 3 : 0,
    _enableWrapText: !!wrap,
    _font: null,
    _isSystemFontUsed: true,
    _spacingX: 0,
    _isItalic: false,
    _isBold: false,
    _isUnderline: false,
    _underlineHeight: 2,
    _cacheMode: 0,
    _enableOutline: false,
    _outlineColor: { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 255 },
    _outlineWidth: 2,
    _enableShadow: false,
    _shadowColor: { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 255 },
    _shadowOffset: { __type__: 'cc.Vec2', x: 2, y: 2 },
    _shadowBlur: 2,
    _id: '',
  });
  return labelId;
}

function pushPrefabInfo(data, fileId) {
  const id = data.length;
  data.push({
    __type__: 'cc.PrefabInfo',
    root: { __id__: 1 },
    asset: { __id__: 0 },
    fileId,
    instance: null,
    targetOverrides: null,
    nestedPrefabInstanceRoots: null,
  });
  return id;
}

/** BtnReset -> label-only Body */
function convertResetToLabelNode(data, btnReset, nodeId, name, y, text, fontSize, color, wrap, height) {
  btnReset._name = name;
  btnReset._lpos = { __type__: 'cc.Vec3', x: 0, y, z: 0 };
  btnReset._components = btnReset._components.filter(ref => {
    const t = data[ref.__id__]?.__type__;
    return t === 'cc.UITransform' || t === 'cc.CompPrefabInfo' || t === 'cc.PrefabInfo';
  });
  const utRef = btnReset._components.find(ref => data[ref.__id__]?.__type__ === 'cc.UITransform');
  if (utRef) {
    data[utRef.__id__]._contentSize.width = 500;
    data[utRef.__id__]._contentSize.height = height;
  }
  const labelId = pushLabel(data, nodeId, text, fontSize, color, wrap, height, name);
  btnReset._components.push({ __id__: labelId });
}

const loseData = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));
const data = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));

data[0]._name = 'panel_notice';
data[1]._name = 'panel_notice';
data[1]._active = false;

const panel = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Panel');
const btnHome = data.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnHome');
const btnReset = data.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnReset');
const panelId = data.indexOf(panel);
const btnHomeId = data.indexOf(btnHome);
const btnResetId = data.indexOf(btnReset);

// BtnHome giữ nguyên là nút OK
btnHome._name = 'BtnOk';
btnHome._lpos = { __type__: 'cc.Vec3', x: 0, y: -120, z: 0 };
const btnOkButton = data.find(o => o.__type__ === 'cc.Button' && o.node?.__id__ === btnHomeId);
if (btnOkButton) btnOkButton._target = { __id__: btnHomeId };

// BtnReset -> Body (chỉ label)
convertResetToLabelNode(
  data,
  btnReset,
  btnResetId,
  'Body',
  10,
  'Stay tuned for the next update to unlock more exciting videos!',
  30,
  { r: 255, g: 255, b: 255, a: 255 },
  true,
  140,
);

// Title node mới (clone transform từ BtnReset gốc trong lose)
const loseBtnReset = loseData.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnReset');
const titleId = data.length;
const titleNode = JSON.parse(JSON.stringify(loseBtnReset));
titleNode._name = 'Title';
titleNode._parent = { __id__: panelId };
titleNode._lpos = { __type__: 'cc.Vec3', x: 0, y: 100, z: 0 };
titleNode._children = [];
titleNode._components = [];
data.push(titleNode);
panel._children.unshift({ __id__: titleId });

for (const ref of loseBtnReset._components) {
  const comp = loseData[ref.__id__];
  if (!comp || comp.__type__ !== 'cc.UITransform') continue;
  const infoId = pushCompInfo(data, 'TitleUtInfo');
  const copy = JSON.parse(JSON.stringify(comp));
  copy.node = { __id__: titleId };
  copy.__prefab = { __id__: infoId };
  copy._contentSize = { __type__: 'cc.Size', width: 500, height: 64 };
  const compId = data.length;
  data.push(copy);
  titleNode._components.push({ __id__: compId });
}
const titleLabelId = pushLabel(
  data,
  titleId,
  'Level 50 Complete!',
  38,
  { r: 255, g: 220, b: 90, a: 255 },
  false,
  64,
  'Title',
);
titleNode._components.push({ __id__: titleLabelId });
const titlePrefabInfoId = pushPrefabInfo(data, 'TitlePrefabInfo');
titleNode._prefab = { __id__: titlePrefabInfoId };

// Script NoticePopupPanel
const scriptType = compressUuid(NOTICE_SCRIPT_UUID);
const scriptComp = data.find(o => o.__type__ === FAILED_SCRIPT_TYPE);
if (!scriptComp) throw new Error('LevelFailedPanel script block not found');

scriptComp.__type__ = scriptType;
scriptComp.contentNode = { __id__: panelId };
scriptComp.backgroundBlocker = { __id__: data.find(o => o.__type__ === 'cc.Node' && o._name === 'Overlay') ? data.indexOf(data.find(o => o.__type__ === 'cc.Node' && o._name === 'Overlay')) : null };
scriptComp.titleLabel = { __id__: titleLabelId };
scriptComp.bodyLabel = { __id__: data.find(o => o.__type__ === 'cc.Label' && o.node?.__id__ === btnResetId) ? data.indexOf(data.find(o => o.__type__ === 'cc.Label' && o.node?.__id__ === btnResetId)) : null };
scriptComp.okButton = btnOkButton ? { __id__: data.indexOf(btnOkButton) } : null;
delete scriptComp.homeButton;
delete scriptComp.replayButton;

fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Built', OUT);
console.log('NoticePopupPanel __type__ =', scriptType);
