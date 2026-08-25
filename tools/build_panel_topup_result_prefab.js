/**
 * Tạo panel_topup_result.prefab (popup thiếu sao Tevi / top-up failed).
 * Chạy: node tools/build_panel_topup_result_prefab.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'resources', 'prefabs', 'ui', 'panel_lose.prefab');
const OUT = path.join(ROOT, 'assets', 'resources', 'prefabs', 'ui', 'panel_topup_result.prefab');
const SCRIPT_UUID = 'c3d4e5f6-a7b8-9012-cdef-123456789abc';
const FAILED_SCRIPT_TYPE = '6eafdkfxMRHeajZoeOjNb0y';

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

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

function pushLabel(data, nodeId, text, fontSize, color, wrap, filePrefix) {
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
    _overflow: 1,
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

function convertBtnToLabelNode(data, btnNode, nodeId, name, y, text, fontSize, color, wrap, width, height) {
  btnNode._name = name;
  btnNode._lpos = { __type__: 'cc.Vec3', x: 0, y, z: 0 };
  btnNode._components = btnNode._components.filter(ref => {
    const t = data[ref.__id__]?.__type__;
    return t === 'cc.UITransform' || t === 'cc.CompPrefabInfo' || t === 'cc.PrefabInfo';
  });
  const utRef = btnNode._components.find(ref => data[ref.__id__]?.__type__ === 'cc.UITransform');
  if (utRef) {
    data[utRef.__id__]._contentSize.width = width;
    data[utRef.__id__]._contentSize.height = height;
  }
  const labelId = pushLabel(data, nodeId, text, fontSize, color, wrap, name);
  btnNode._components.push({ __id__: labelId });
  return labelId;
}

const SAMPLE_TITLE = 'Insufficient Tevi Stars';
const SAMPLE_BODY =
  'Not enough Tevi Stars.\n\n'
  + 'Your wallet: 0 ★\n'
  + 'This pack needs: 100 ★\n\n'
  + 'Top up your Tevi wallet first, then try again.';

const loseData = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));
const data = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));

data[0]._name = 'panel_topup_result';
data[1]._name = 'panel_topup_result';
data[1]._active = true;

const panel = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Panel');
const btnHome = data.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnHome');
const btnReset = data.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnReset');
const panelId = data.indexOf(panel);
const btnHomeId = data.indexOf(btnHome);
const btnResetId = data.indexOf(btnReset);
const overlayNode = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Overlay');
const overlayId = data.indexOf(overlayNode);

// Panel dialog 680×520 (không full màn)
const panelUt = data.find(o => o.__type__ === 'cc.UITransform' && o.node?.__id__ === panelId);
if (panelUt) {
  panelUt._contentSize = { __type__: 'cc.Size', width: 680, height: 520 };
}

// BtnOk — dưới cùng
btnHome._name = 'BtnOk';
btnHome._lpos = { __type__: 'cc.Vec3', x: 0, y: -192, z: 0 };
const btnOkUt = data.find(o => o.__type__ === 'cc.UITransform' && o.node?.__id__ === btnHomeId);
if (btnOkUt) {
  btnOkUt._contentSize = { __type__: 'cc.Size', width: 220, height: 64 };
}
const btnOkButton = data.find(o => o.__type__ === 'cc.Button' && o.node?.__id__ === btnHomeId);
if (btnOkButton) btnOkButton._target = { __id__: btnHomeId };

// BtnReset -> Body
const bodyLabelId = convertBtnToLabelNode(
  data,
  btnReset,
  btnResetId,
  'Body',
  0,
  SAMPLE_BODY,
  26,
  { r: 255, g: 255, b: 255, a: 255 },
  true,
  616,
  280,
);

// Title node
const loseBtnReset = loseData.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnReset');
const titleId = data.length;
const titleNode = JSON.parse(JSON.stringify(loseBtnReset));
titleNode._name = 'Title';
titleNode._parent = { __id__: panelId };
titleNode._lpos = { __type__: 'cc.Vec3', x: 0, y: 192, z: 0 };
titleNode._children = [];
titleNode._components = [];
data.push(titleNode);
panel._children.unshift({ __id__: titleId });

for (const ref of loseBtnReset._components) {
  const comp = loseData[ref.__id__];
  if (!comp || comp.__type__ !== 'cc.UITransform') continue;
  const infoId = pushCompInfo(data, 'TopUpTitleUt');
  const copy = JSON.parse(JSON.stringify(comp));
  copy.node = { __id__: titleId };
  copy.__prefab = { __id__: infoId };
  copy._contentSize = { __type__: 'cc.Size', width: 616, height: 64 };
  const compId = data.length;
  data.push(copy);
  titleNode._components.push({ __id__: compId });
}
const titleLabelId = pushLabel(
  data,
  titleId,
  SAMPLE_TITLE,
  34,
  { r: 255, g: 220, b: 90, a: 255 },
  false,
  'TopUpTitle',
);
titleNode._components.push({ __id__: titleLabelId });
const titlePrefabInfoId = pushPrefabInfo(data, 'TopUpTitlePrefab');
titleNode._prefab = { __id__: titlePrefabInfoId };

// Script TopUpResultPopupPanel
const scriptType = compressUuid(SCRIPT_UUID);
const scriptComp = data.find(o => o.__type__ === FAILED_SCRIPT_TYPE);
if (!scriptComp) throw new Error('LevelFailedPanel script block not found');

scriptComp.__type__ = scriptType;
scriptComp.contentNode = { __id__: panelId };
scriptComp.backgroundBlocker = { __id__: overlayId };
scriptComp.titleLabel = { __id__: titleLabelId };
scriptComp.bodyLabel = { __id__: bodyLabelId };
scriptComp.okButton = btnOkButton ? { __id__: data.indexOf(btnOkButton) } : null;
delete scriptComp.homeButton;
delete scriptComp.replayButton;

fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Built', OUT);
console.log('TopUpResultPopupPanel __type__ =', scriptType);
