/**
 * 引入 ranui 的全局自定义元素声明（HTMLElementTagNameMap 里的 r-button /
 * r-checkbox 等）。子路径导入只带来该组件自身的类型，全局映射在包的主入口里，
 * 所以这里显式引一次 —— 有了它，querySelector('r-checkbox') 才有类型。
 */
/// <reference types="ranui" />
export {};
