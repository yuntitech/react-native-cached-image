"use strict";

const _ = require("lodash");

const fsUtils = require("./utils/fsUtils");
const pathUtils = require("./utils/pathUtils");
const MemoryCache = require("react-native-clcasher/MemoryCache").default;

module.exports = (
  defaultOptions = {},
  urlCache = MemoryCache,
  fs = fsUtils,
  path = pathUtils
) => {
  const defaultDefaultOptions = {
    headers: {},
    ttl: 60 * 60 * 24 * 14, // 2 weeks
    useQueryParamsInCacheKey: false,
    cacheLocation: fs.getCacheDir(),
    allowSelfSignedSSL: false
  };

  // apply default options
  _.defaults(defaultOptions, defaultDefaultOptions);

  function isCacheable(url) {
    return (
      _.isString(url) &&
      (_.startsWith(url.toLowerCase(), "http://") ||
        _.startsWith(url.toLowerCase(), "https://"))
    );
  }

  function cacheUrl(url, options, getCachedFile) {
    if (!isCacheable(url)) {
      return Promise.reject(new Error("Url is not cacheable"));
    }
    // allow CachedImage to provide custom options
    _.defaults(options, defaultOptions);
    // cacheableUrl contains only the needed query params
    const cacheableUrl = path.getCacheableUrl(
      url,
      options.useQueryParamsInCacheKey
    );
    // note: urlCache may remove the entry if it expired so we need to remove the leftover file manually
    return (
      urlCache
        .get(cacheableUrl)
        .then(fileRelativePath => {
          if (!fileRelativePath) {
            // console.log('ImageCacheManager: url cache miss', cacheableUrl);
            throw new Error("URL expired or not in cache");
          }
          // console.log('ImageCacheManager: url cache hit', cacheableUrl);
          const cachedFilePath = `${options.cacheLocation}/${fileRelativePath}`;

          return fs.exists(cachedFilePath).then(exists => {
            if (exists) {
              return cachedFilePath;
            } else {
              throw new Error(
                "file under URL stored in url cache doesn't exsts"
              );
            }
          });
        })
        // url is not found in the cache or is expired
        .catch(() => {
          const fileRelativePath = path.getImageRelativeFilePath(cacheableUrl);
          const filePath = `${options.cacheLocation}/${fileRelativePath}`;

          // remove expired file if exists
          return (
            fs
              .deleteFile(filePath)
              // get the image to cache (download / copy / etc)
              .then(() => getCachedFile(filePath))
              // add to cache
              .then(() =>
                urlCache.set(cacheableUrl, fileRelativePath, options.ttl)
              )
              // return filePath
              .then(() => filePath)
          );
        })
    );
  }

  return {
    /**
     * 判断某个 url 图片是否已经下载, 使用和 downloadAndCacheUrl一样的判断方法
     * @param url
     * @param options
     * @returns {Promise}
     */
    isCachedURL(url, options = {}) {
      let noCached = false;
      return cacheUrl(url, options, filePath => {
        //来到这说明执行了cacheUrl的 catch 方法, 即文件不存在或者过期了
        noCached = true;
      }).then(() => {
        //总会执行这个方法, 所以根据是否已经执行 catch 判断缓存是否存在
        return new Promise(resolve => {
          resolve(!noCached);
        });
      });
    },

    //判断 URL 是否可以缓存
    isURLCacheable(url) {
      return isCacheable(url);
    },

    /**
     * download an image and cache the result according to the given options
     * @param url
     * @param options
     * @returns {Promise}
     */
    downloadAndCacheUrl(url, options = {}) {
      return cacheUrl(url, options, filePath =>
        fs.downloadFile(url, filePath, options.headers)
      );
    },

    /**
     * seed the cache for a specific url with a local file
     * @param url
     * @param seedPath
     * @param options
     * @returns {Promise}
     */
    seedAndCacheUrl(url, seedPath, options = {}) {
      return cacheUrl(url, options, filePath =>
        fs.copyFile(seedPath, filePath)
      );
    },

    /**
     * delete the cache entry and file for a given url
     * @param url
     * @param options
     * @returns {Promise}
     */
    deleteUrl(url, options = {}) {
      if (!isCacheable(url)) {
        return Promise.reject(new Error("Url is not cacheable"));
      }
      _.defaults(options, defaultOptions);
      const cacheableUrl = path.getCacheableUrl(
        url,
        options.useQueryParamsInCacheKey
      );
      const filePath = path.getImageFilePath(
        cacheableUrl,
        options.cacheLocation
      );
      // remove file from cache
      return (
        urlCache
          .remove(cacheableUrl)
          // remove file from disc
          .then(() => fs.deleteFile(filePath))
      );
    },

    /**
     * delete all cached file from the filesystem and cache
     * @param options
     * @returns {Promise}
     */
    clearCache(options = {}) {
      _.defaults(options, defaultOptions);
      return urlCache.flush().then(() => fs.cleanDir(options.cacheLocation));
    },

    /**
     * return info about the cache, list of files and the total size of the cache
     * @param options
     * @returns {Promise.<{file: Array, size: Number}>}
     */
    getCacheInfo(options = {}) {
      _.defaults(options, defaultOptions);
      return fs.getDirInfo(options.cacheLocation);
    }
  };
};
