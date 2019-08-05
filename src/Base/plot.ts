import * as G2 from '@antv/g2';
import * as _ from '@antv/util';
import Theme from '../theme';
import { DataPointType } from '@antv/g2/lib/interface';
import { BBox } from '@antv/g';
import PlotConfig, { G2Config } from '../interface/config';
import getAutoPadding from '../util/padding';
import { EVENT_MAP, onEvent } from '../util/event';
import TextDescription from '../components/description';
import CanvasController from './controller/canvas';
import ThemeController from './controller/theme';

export default abstract class BasePlot<T extends PlotConfig = PlotConfig> {
  /** g2实例 */
  public type: string = 'base';
  private _container: HTMLElement;
  public plot: G2.View;
  public destroyed: boolean = false;
  public _initialProps: T;
  protected _originalProps: T;
  protected _config: G2Config;
  public eventHandlers: any[] = [];
  protected paddingComponents: any[] = [];
  protected title: TextDescription;
  protected description: TextDescription;
  protected plotTheme: any;
  private canvasController: CanvasController;
  private themeController: ThemeController;

  constructor(container: string | HTMLElement, config: T) {
    /**
     * 储存初始化配置项，获取图表主题，创建图表容器及画布
     */
    this._initialProps = config;
    this._originalProps = _.deepMix({}, config);
    this._container = _.isString(container) ? document.getElementById(container) : container;
    this.canvasController = new CanvasController({
      container: this._container,
      plot: this
    });
    this.themeController = new ThemeController({
      plot: this
    });
    this.plotTheme = this.themeController.plotTheme;
    /**
     * 启动主流程，挂载钩子
     */
    this._beforeInit();
    this._init(this._container, this.canvasController);
    this._afterInit();
  }

  protected _init(container: HTMLElement, canvasController) {
    const props = this._initialProps;
    const theme = this.themeController.theme;
    this._config = {
      scales: {},
      legends: {
        position: theme.defaultLegendPosition,
      },
      tooltip: {
        showTitle: true,
        triggerOn: 'mousemove',
        inPanel: true,
        useHtml: true,
      },
      axes: { fields: {} },
      coord: { type: 'cartesian' },
      elements: [],
      annotations: [],
      interactions: {},
      theme: theme,
      panelRange: {},
    };
     
    //todo: 太丑了，待优化
    if (theme.backgroundStyle && theme.backgroundStyle.fill) {
      this.canvasController.canvas.get('canvasDOM').style.backgroundColor = theme.backgroundStyle.fill;
    }
    /** 绘制title & description */
    const range = this._getPanelRange();
    this._config.panelRange = range;

    this._title(range);
    this._description(range);

    const viewMargin = this._getViewMargin();

    this._setDefaultG2Config();
    this._coord();
    this._scale();
    this._axis();
    this._tooltip();
    this._legend();
    this._addElements();
    this._annotation();
    this._animation();

    // 补充scale配置
    const scales = _.mapValues(this._config.scales, (scaleConfig: any, field: string) => {
      const meta: PlotConfig['meta']['key'] = _.get(props.meta, field);
      // meta中存在对应配置，则补充入
      if (meta) {
        return _.assign({}, scaleConfig, meta);
      }
      return scaleConfig;
    });
    this._setConfig('scales', scales);

    this.plot = new G2.View({
      width: this.canvasController.width,
      height: this.canvasController.height,
      canvas: this.canvasController.canvas,
      container: this.canvasController.canvas.addGroup(),
      padding: this._getPadding(),
      data: props.data,
      theme: this._config.theme,
      options: this._config,
      start: { x: 0, y: viewMargin.maxY },
      end: { x: this.canvasController.width, y: this.canvasController.height },
    });
    this._interactions();
    this._events();
  }

  /** 设置G2默认配置项 */
  protected abstract _setDefaultG2Config(): void;

  /** 配置G2 */
  protected abstract _scale(): void;
  protected abstract _axis(): void;
  protected abstract _coord(): void;
  protected abstract _annotation(): void;
  protected abstract _addElements(): void;
  protected abstract _animation(): void;
  protected abstract _interactions(): void;

  protected _events(eventParser?): void {
    const props = this._initialProps;
    if (props.events) {
      const events = props.events;
      const eventmap = eventParser ? eventParser.EVENT_MAP : EVENT_MAP;
      _.each(events, (e, k) => {
        if (_.isFunction(e)) {
          const eventName = eventmap[e.name] || k;
          const handler = e;
          onEvent(this, eventName, handler);
        }
      });
    }
  }

  /** plot通用配置 */
  protected _tooltip(): void {
    const props = this._initialProps;
    if (props.tooltip && props.tooltip.visible === false) {
      this._setConfig('tooltip', false);
      return;
    }
    this._setConfig('tooltip', {
      crosshairs: _.get(props, 'tooltip.crosshairs'),
    });
    this._setConfig('tooltip', {
      shared: _.get(props, 'tooltip.shared'),
    });
    if (props.tooltip && props.tooltip.style) {
      _.deepMix(this._config.theme.tooltip, props.tooltip.style);
    }
  }

  protected _legend(): void {
    const props = this._initialProps;
    if (props.legend && props.legend.visible === false) {
      this._setConfig('legends', false);
      return;
    }

    this._setConfig('legends', {
      position: _.get(props, 'legend.position'),
    });
    this._setConfig('legends', {
      formatter: _.get(props, 'legend.formatter'),
    });
    this._setConfig('legends', {
      offsetX: _.get(props, 'legend.offsetX'),
    });
    this._setConfig('legends', {
      offsetY: _.get(props, 'legend.offsetY'),
    });

    const flipOption = _.get(props, 'legend.flipPage');
    this._setConfig('legends', {
      flipPage: flipOption,
    });
  }

  protected _title(panelRange: BBox): void {
    const props = this._initialProps;
    this.title = null;
    if (props.title) {
      const theme = this._config.theme;
      const alignWithAxis = _.mix(props.title.alignWithAxis,theme.title.alignWithAxis);
      const title = new TextDescription({
        leftMargin:panelRange.minX,
        topMargin: theme.title.top_margin,
        text: props.title.text,
        style: _.mix(theme.title, props.title.style),
        wrapperWidth: panelRange.width,
        container: this.canvasController.canvas,
        theme,
        alignWithAxis,
      });
      this.title = title;
    }
  }

  protected _description(panelRange: BBox): void {
    const props = this._initialProps;
    this.description = null;
    
    if (props.description) {
      let topMargin = 0;
      if (this.title) {
        const titleBBox = this.title.getBBox();
        topMargin = titleBBox.minY + titleBBox.height;
      }

      const theme = this._config.theme;
      const alignWithAxis = _.mix(props.title.alignWithAxis,theme.title.alignWithAxis);

      const description = new TextDescription({
        leftMargin:panelRange.minX,
        topMargin: topMargin + theme.description.top_margin,
        text: props.description.text,
        style: _.mix(theme.description, props.description.style),
        wrapperWidth: panelRange.width,
        container: this.canvasController.canvas,
        theme,
        alignWithAxis,
      });

      this.description = description;
    }
  }

  protected _beforeInit() { }

  protected _afterInit() {
    const props = this._initialProps;
    const padding = props.padding ? props.padding : this._config.theme.padding;
    /** 处理autopadding逻辑 */
    if (padding === 'auto') {
      this.plot.render(false);
      const padding = getAutoPadding(this.plot, this.paddingComponents, this._config.theme.defaultPadding);
      this.updateConfig({
        padding,
      });
    }
  }

  /** 设置G2 config，带有类型推导 */
  protected _setConfig<T extends keyof G2Config>(key: T, config: G2Config[T] | boolean): void {
    if (key === 'element') {
      this._config.elements.push(config as G2Config['element']);
      return;
    }
    if (config as boolean === false) {
      this._config[key] = false;
      return;
    }
    _.assign(this._config[key], config);
  }

  protected _convert2G2Theme(plotTheme) {
    return Theme.convert2G2Theme(plotTheme);
  }

  /** 自定义组件参与padding */
  public resgiterPadding(components: Element) {
    this.paddingComponents.push(components);
  }

  /** 修改数据 */
  public changeData(data: object[]): void {
    this.plot.changeData(data);
  }

  /** 完整生命周期渲染 */
  public render(): void {
    const data = this._initialProps.data;
    if (!_.isEmpty(data)) {
      this.plot.render();
    }
  }

  /** 画布内容重绘 */
  public repaint(): void {
    this.plot.get('canvas').draw();
  }

  /** 销毁 */
  public destroy(): void {
    this.canvasController.destory();
    _.each(this.eventHandlers, (handler) => {
      this.plot.off(handler.type, handler.handler);
    });
    /** 移除title & description */
    this.title && this.title.destory();
    this.description && this.description.destory();
    const canvasDOM = this.canvasController.canvas.get('canvasDOM');
    canvasDOM.parentNode.removeChild(canvasDOM);
    /** TODO: g2底层view销毁时没有销毁tooltip,经查是tooltip迁移过程中去掉了destory方法 */
    this.plot.destroy();
    this.destroyed = true;
  }

  /** 更新配置项 */
  public updateConfig(cfg): void {
    if(!cfg.padding && this._originalProps.padding && this._originalProps.padding === 'auto'){
      cfg.padding = 'auto';
    }
    const newProps = _.deepMix({}, this._initialProps, cfg);
    
    _.each(this.eventHandlers, (handler) => {
      this.plot.off(handler.type, handler.handler);
    });
    this.plot.destroy();
    /** 移除title & description */
    if (this.title) this.title.destory();
    if (this.description) this.description.destory();
    this._initialProps = newProps;
    this.canvasController.updateCanvasSize();
    this._beforeInit();
    this._init(this._container, this.canvasController);
    this._afterInit();
  }

  private _getPadding() {
    const props = this._initialProps;
    const padding = props.padding ? props.padding : this._config.theme.padding;
    if (padding === 'auto') return [0, 0, 0, 0];
    return padding;
  }

  // 为了方便图表布局，title和description在view创建之前绘制，需要先计算view的plotRange,方便title & description文字折行
  private _getPanelRange() {
    const padding = this._getPadding();
    const width = this.canvasController.width;
    const height = this.canvasController.height;
    const top = padding[0];
    const right = padding[1];
    const bottom = padding[2];
    const left = padding[3];
    return new BBox(left, top, width - left - right, height - top - bottom);
  }

  // view range 去除title & description所占的空间
  private _getViewMargin() {
    const boxes = [];
    if (this.title) boxes.push(this.title.getBBox());
    if (this.description) boxes.push(this.description.getBBox());
    if (boxes.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    } {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = - Infinity;
      _.each(boxes, (bbox) => {
        const box = bbox as DataPointType;
        minX = Math.min(box.minX, minX);
        maxX = Math.max(box.maxX, maxX);
        minY = Math.min(box.minY, minY);
        maxY = Math.max(box.maxY, maxY);
      });
      const bbox = { minX, maxX, minY, maxY };
      if (this.description) bbox.maxY += this._config.theme.description.bottom_margin;

      /** 约束viewRange的start.y，防止坐标轴出现转置 */
      if (bbox.maxY >= this.canvasController.height) {
        bbox.maxY = this.canvasController.height - 0.1;
      }
      return bbox;
    }
  }
}
