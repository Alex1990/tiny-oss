

# tiny-oss

Un SDK ligero de Aliyun OSS para navegador, centrado en la carga de archivos. Menos de 10kb (minimizado y gzipped).

**English | [简体中文](README_zh-CN.md)**

## Instalación

Npm

```sh
npm install tiny-oss
```

Yarn

```sh
yarn add tiny-oss
```

## Uso

### Básico

```js
const oss = new TinyOSS({
  accessKeyId: 'your accessKeyId',
  accessKeySecret: 'your accessKeySecret',
  // Recommend to use the stsToken option in browser
  stsToken: 'security token',
  region: 'oss-cn-beijing',
  bucket: 'your bucket'
});

const blob = new Blob(['hello world'], { type: 'text/plain' });

// Upload
oss.put('hello-world', blob);
```

### Progreso de carga

Puede especificar el tercer parámetro para monitorear los datos de progreso de la carga:

```js
// Upload progress
oss.put('hello-world', blob, {
  onprogress (e) {
    console.log('total: ', e.total, ', uploaded: ', e.loaded);
  }
});
```

Para ver más opciones o métodos, consulte la [API](#api).

## Compatibilidad

Este paquete depende de algunas API web modernas, como [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob), [Uint8Array](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array), [FileReader](https://developer.mozilla.org/en-US/docs/Web/API/FileReader), [Promise](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise).

Por lo tanto, debería funcionar en los siguientes navegadores.

* Chrome >= 20
* Edge >= 12
* IE >= 10
* Firefox >= 4
* Safari >= 8
* Opera >= 11
* Android >= 4.4.4
* iOS >= 8

**Para IE y versiones antiguas de FireFox, debe importar un polyfill de promesas, como [es6-promise](https://github.com/stefanpenner/es6-promise)**.

## API

```js
new TinyOSS(options)
```

### options

Consulte la [documentación oficial de Browser.js](https://help.aliyun.com/document_detail/64095.html?spm=a2c4g.11186623.6.1122.27976928XhTpTr).

* accessKeyId
* accessKeySecret
* stsToken
* bucket
* endpoint
* region
* secure
* timeout

### put(objectName, blob, options)

Carga el blob.

#### Argumentos

* **objectName (String)**: El nombre del objeto.
* **blob (Blob|File)**: El objeto que se va a cargar.
* **[options (Object)]**
  + **[onprogress (Function)]**: El controlador de eventos de progreso de carga que recibe un objeto de [evento de progreso](https://developer.mozilla.org/en-US/docs/Web/API/XMLHttpRequest/progress_event) como parámetro.

#### Retorna

* **(Promise)**

### putSymlink(objectName, targetObjectName)

Crea un enlace simbólico.

#### Argumentos

* **objectName (String)**: El nombre del objeto de enlace simbólico.
* **targetObjectName (String)**: El nombre del objeto destino.

#### Retorna

* **(Promise)**

### signatureUrl(objectName, options)

Obtiene una URL firmada para descargar el archivo.

#### Argumentos

* **objectName (String)**: El nombre del objeto.
* **[options (Object)]**:
  + **[options.expires (Number)]**: La expiración de la URL (unidad: segundos).

#### Retorna

* **(String)**

## LICENCIA

MIT
