/**
 * Build panel_tutorial.prefab from panel_notice.prefab.
 * Run: node tools/build_panel_tutorial_prefab.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'resources', 'prefabs', 'ui', 'panel_notice.prefab');
const OUT = path.join(ROOT, 'assets', 'resources', 'prefabs', 'ui', 'panel_tutorial.prefab');
const TUTORIAL_SCRIPT_UUID = 'e7f8a9b0-c1d2-4e3f-a4b5-c6d7e8f90123';
const NOTICE_SCRIPT_TYPE = 'a1b2cPU5fZ4kKvN7xI0VniQ';
const WHITE_SPRITE = 'b730527c-3233-41c2-aaf7-7cdab58f9749@f9941';

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function compressUuid(fullUuid) {
  const hex = fullUuid.replace(/-/g, '');
  if (hex.length !== 32) return fullUuid;
  let i = 5;
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

function makeNode(data, name, parentId, x, y, w, h, filePrefix) {
  const nodeId = data.length;
  const node = {
    __type__: 'cc.Node',
    _name: name,
    _objFlags: 0,
    __editorExtras__: {},
    _parent: parentId === null ? null : { __id__: parentId },
    _children: [],
    _active: true,
    _components: [],
    _prefab: null,
    _lpos: { __type__: 'cc.Vec3', x, y, z: 0 },
    _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 },
    _mobility: 0,
    _layer: 33554432,
    _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 },
    _id: '',
  };
  data.push(node);

  const utInfo = pushCompInfo(data, `${filePrefix}UtInfo`);
  const utId = data.length;
  data.push({
    __type__: 'cc.UITransform',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: utInfo },
    _contentSize: { __type__: 'cc.Size', width: w, height: h },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 },
    _id: '',
  });
  node._components.push({ __id__: utId });
  node._prefab = { __id__: pushPrefabInfo(data, `${filePrefix}Prefab`) };
  return { nodeId, node, utId };
}

function pushSprite(data, nodeId, color, filePrefix) {
  const infoId = pushCompInfo(data, `${filePrefix}SpInfo`);
  const id = data.length;
  data.push({
    __type__: 'cc.Sprite',
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
    _spriteFrame: { __uuid__: WHITE_SPRITE, __expectedType__: 'cc.SpriteFrame' },
    _type: 1,
    _fillType: 0,
    _sizeMode: 0,
    _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
    _fillStart: 0,
    _fillRange: 0,
    _isTrimmedMode: true,
    _useGrayscale: false,
    _atlas: null,
    _id: '',
  });
  return id;
}

function pushBlock(data, nodeId, filePrefix) {
  const infoId = pushCompInfo(data, `${filePrefix}BlkInfo`);
  const id = data.length;
  data.push({
    __type__: 'cc.BlockInputEvents',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: infoId },
    _id: '',
  });
  return id;
}

function pushButton(data, nodeId, filePrefix) {
  const infoId = pushCompInfo(data, `${filePrefix}BtnInfo`);
  const id = data.length;
  data.push({
    __type__: 'cc.Button',
    _name: '',
    _objFlags: 0,
    __editorExtras__: {},
    node: { __id__: nodeId },
    _enabled: true,
    __prefab: { __id__: infoId },
    clickEvents: [],
    _interactable: true,
    _transition: 3,
    _normalColor: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _hoverColor: { __type__: 'cc.Color', r: 211, g: 211, b: 211, a: 255 },
    _pressedColor: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
    _disabledColor: { __type__: 'cc.Color', r: 124, g: 124, b: 124, a: 255 },
    _normalSprite: null,
    _hoverSprite: null,
    _pressedSprite: null,
    _disabledSprite: null,
    _duration: 0.1,
    _zoomScale: 0.94,
    _target: { __id__: nodeId },
    _id: '',
  });
  return id;
}

const data = JSON.parse(fs.readFileSync(SRC, 'utf8').replace(/^\uFEFF/, ''));
data[0]._name = 'panel_tutorial';
data[1]._name = 'panel_tutorial';
data[1]._active = true;

const overlayNode = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Overlay');
const panelNode = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Panel');
const titleNode = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Title');
const bodyNode = data.find(o => o.__type__ === 'cc.Node' && o._name === 'Body');
const btnOkNode = data.find(o => o.__type__ === 'cc.Node' && o._name === 'BtnOk');
const overlayId = data.indexOf(overlayNode);
const panelId = data.indexOf(panelNode);
const titleId = data.indexOf(titleNode);
const bodyId = data.indexOf(bodyNode);
const btnOkId = data.indexOf(btnOkNode);

panelNode._name = 'Popup';
btnOkNode._name = 'BtnNext';
btnOkNode._lpos = { __type__: 'cc.Vec3', x: 0, y: -100, z: 0 };

const titleLabel = data.find(o => o.__type__ === 'cc.Label' && o.node?.__id__ === titleId);
const bodyLabel = data.find(o => o.__type__ === 'cc.Label' && o.node?.__id__ === bodyId);
const btnButton = data.find(o => o.__type__ === 'cc.Button' && o.node?.__id__ === btnOkId);

if (titleLabel) {
  titleLabel._string = 'Your Order';
  titleLabel._isBold = true;
}
if (bodyLabel) {
  bodyLabel._string = 'This is your Order. Collect each item shown here in the same sequence.';
  bodyLabel._enableWrapText = true;
  bodyLabel._overflow = 3;
}

if (titleNode) titleNode._lpos = { __type__: 'cc.Vec3', x: 0, y: 100, z: 0 };
if (bodyNode) bodyNode._lpos = { __type__: 'cc.Vec3', x: 0, y: 10, z: 0 };
const nextLabel = makeNode(data, 'Label', btnOkId, 0, 0, 200, 52, 'NextLabel');
btnOkNode._children.push({ __id__: nextLabel.nodeId });
const nextLabelInfo = pushCompInfo(data, 'NextLabelInfo');
const nextLabelId = data.length;
data.push({
  __type__: 'cc.Label',
  _name: '',
  _objFlags: 0,
  __editorExtras__: {},
  node: { __id__: nextLabel.nodeId },
  _enabled: true,
  __prefab: { __id__: nextLabelInfo },
  _customMaterial: null,
  _srcBlendFactor: 2,
  _dstBlendFactor: 4,
  _color: { __type__: 'cc.Color', r: 255, g: 255, b: 255, a: 255 },
  _string: 'Next',
  _horizontalAlign: 1,
  _verticalAlign: 1,
  _actualFontSize: 30,
  _fontSize: 30,
  _fontFamily: 'Arial',
  _lineHeight: 34,
  _overflow: 0,
  _enableWrapText: false,
  _font: null,
  _isSystemFontUsed: true,
  _spacingX: 0,
  _isItalic: false,
  _isBold: true,
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
nextLabel.node._components.push({ __id__: nextLabelId });

const guide = makeNode(data, 'GuideGroup', 1, 0, 0, 10, 10, 'Guide');
const highlight = makeNode(data, 'Highlight', 1, 0, 0, 160, 160, 'Highlight');
const hotspot = makeNode(data, 'Hotspot', 1, 0, 0, 160, 160, 'Hotspot');
const hand = makeNode(data, 'Hand', guide.nodeId, 90, -80, 90, 140, 'Hand');
const handMotion = makeNode(data, 'HandMotion', hand.nodeId, 0, 0, 90, 140, 'HandMotion');
const finger = makeNode(data, 'Finger', handMotion.nodeId, 0, 0, 90, 140, 'Finger');

guide.node._children.push({ __id__: hand.nodeId }, { __id__: panelId });
hand.node._children.push({ __id__: handMotion.nodeId });
handMotion.node._children.push({ __id__: finger.nodeId });

hotspot.node._components.push({ __id__: pushButton(data, hotspot.nodeId, 'Hotspot') });
highlight.node._active = false;
hotspot.node._active = false;

const popupBlockId = pushBlock(data, panelId, 'Popup');
panelNode._components.push({ __id__: popupBlockId });
panelNode._parent = { __id__: guide.nodeId };
panelNode._lpos = { __type__: 'cc.Vec3', x: 0, y: 180, z: 0 };

const panelUt = data.find(o => o.__type__ === 'cc.UITransform' && o.node?.__id__ === panelId);
if (panelUt) {
  panelUt._contentSize = { __type__: 'cc.Size', width: 640, height: 300 };
}

data[1]._children = [
  { __id__: overlayId },
  { __id__: highlight.nodeId },
  { __id__: hotspot.nodeId },
  { __id__: guide.nodeId },
];

const overlaySprite = data.find(o => o.__type__ === 'cc.Sprite' && o.node?.__id__ === overlayId);
if (overlaySprite) {
  overlaySprite._color = { __type__: 'cc.Color', r: 0, g: 0, b: 0, a: 110 };
}

const scriptComp = data.find(o => o.__type__ === NOTICE_SCRIPT_TYPE);
if (!scriptComp) throw new Error('NoticePopupPanel script block not found');
const scriptType = compressUuid(TUTORIAL_SCRIPT_UUID);
scriptComp.__type__ = scriptType;
scriptComp.overlay = { __id__: overlayId };
scriptComp.hotspot = { __id__: hotspot.nodeId };
scriptComp.highlight = { __id__: highlight.nodeId };
scriptComp.guideGroup = { __id__: guide.nodeId };
scriptComp.handNode = { __id__: hand.nodeId };
scriptComp.handMotion = { __id__: handMotion.nodeId };
scriptComp.fingerNode = { __id__: finger.nodeId };
scriptComp.popupNode = { __id__: panelId };
scriptComp.titleLabel = titleLabel ? { __id__: data.indexOf(titleLabel) } : null;
scriptComp.bodyLabel = bodyLabel ? { __id__: data.indexOf(bodyLabel) } : null;
scriptComp.nextButton = btnButton ? { __id__: data.indexOf(btnButton) } : null;
scriptComp.nextButtonLabel = { __id__: nextLabelId };
scriptComp.spineAnimationName = 'idle';
scriptComp.hotspotPadding = 28;
scriptComp.bobDistance = 22;
scriptComp.bobDuration = 0.38;
delete scriptComp.backgroundBlocker;
delete scriptComp.contentNode;
delete scriptComp.okButton;

fs.writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Built', OUT);
console.log('TutorialOverlay __type__ =', scriptType);
