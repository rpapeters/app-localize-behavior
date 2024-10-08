/**
@license
Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
This code may only be used under the BSD style license found at
http://polymer.github.io/LICENSE.txt The complete set of authors may be found at
http://polymer.github.io/AUTHORS.txt The complete set of contributors may be
found at http://polymer.github.io/CONTRIBUTORS.txt Code distributed by Google as
part of the polymer project is also subject to an additional IP rights grant
found at http://polymer.github.io/PATENTS.txt
*/
import '@polymer/iron-ajax/iron-ajax.js';
import '@polymer/polymer/polymer-legacy.js';
import IntlMessageFormat from 'intl-messageformat/src/main.js';
window.IntlMessageFormat = IntlMessageFormat;

/**
 `AppLocalizeBehavior` wraps the [format.js](http://formatjs.io/)
 library to help you internationalize your application. Note that if you're on
 a browser that does not natively support the
 [Intl](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl)
 object, you must load the polyfill yourself. An example polyfill can
 be found [here](https://github.com/andyearnshaw/Intl.js/).

 `AppLocalizeBehavior` supports the same
 [message-syntax](http://formatjs.io/guides/message-syntax/) of format.js, in
 its entirety; use the library docs as reference for the available message
 formats and options.

 Sample application loading resources from an external file:

     import {PolymerElement, html} from '@polymer/polymer';
     import {mixinBehaviors} from '@polymer/polymer/lib/legacy/class.js';
     import {AppLocalizeBehavior} from
         '@polymer/app-localize-behavior/app-localize-behavior.js';

     class SampleElement extends  extends mixinBehaviors(
         [AppLocalizeBehavior], PolymerElement) {
       static get template() {
         return html`
           <div>{{localize('hello', 'name', 'Batman')}}</div>
         `;
       }
       static get properties() {
         return {
           language: { value: 'en' },
         }
       }

       function attached() {
         this.loadResources(this.resolveUrl('locales.json'));
       }
     }
     customElements.define('sample-element', SampleElement);

 If the resources stored in your external file are for a single language and
 so are not nested inside any language keys, you can pass an optional
 `language` parameter to store the fetched resources inside that key.

 This complements the optional third parameter, `merge`, nicely: If you pass
 `merge = true`, the fetched resources will be merged into any existing
 resources rather than clobbering them.

 This is also useful for storing resources for different parts of a page that
 the user might or might not see at the same time in different files, so that
 the user can fetch only the needed resources on-demand, and doesn't have to
 load any resources they'll never see anyway. For example, you could store
 your resources for your global nav, homepage, and FAQ page in 3 different
 files. When a user requests the homepage, both the global nav and the
 homepage resources are fetched and merged together, since they both appear
 on the page at the same time, but you spare the user from fetching the
 unneeded FAQ resources.


 Example:

     attached: function() {
       this.loadResources(
         // Only contains the flattened "es" translations:
         'locales/es.json',  // {"hi": "hola"}
         'es',               // unflatten -> {"es": {"hi": "hola"}}
         true                // merge so existing resources won't be clobbered
       );
     }

 Alternatively, you can also inline your resources inside the app itself:

     import {PolymerElement, html} from '@polymer/polymer';
     import {mixinBehaviors} from '@polymer/polymer/lib/legacy/class.js';
     import {AppLocalizeBehavior} from
         '@polymer/app-localize-behavior/app-localize-behavior.js';

     class SampleElement extends  extends mixinBehaviors(
         [AppLocalizeBehavior], PolymerElement) {
       static get template() {
         return html`
           <div>{{localize('hello', 'name', 'Batman')}}</div>
         `;
       }

       static get properties() {
         return {
           language: { value: 'en' },
           resources: {
             value: function() {
               return {
                 'en': { 'hello': 'My name is {name}.' },
                 'fr': { 'hello': 'Je m\'appelle {name}.' }
               }
           },
         }
       }

       function attached() {
         this.loadResources(this.resolveUrl('locales.json'));
       }
     }
     customElements.define('sample-element', SampleElement);

 @demo demo/index.html
 @polymerBehavior AppLocalizeBehavior
 */
export const AppLocalizeBehavior = {
  /**
   Internal singleton cache. This is the private implementation of the
   behaviour; don't interact with it directly.
   */
  __localizationCache: {
    requests: {}, /* One iron-request per unique resources path. */
    messages: {}, /* Unique localized strings. Invalidated when the language,
                     formats or resources change. */
    ajax: null    /* Global iron-ajax object used to request resource files. */
  },

  /**
   Fired after the resources have been loaded.
   @event app-localize-resources-loaded
   */

  /**
   Fired when the resources cannot be loaded due to an error.
   @event app-localize-resources-error
   */

  properties: {
    /**
     The language used for translation.
     */
    language: {type: String},

    /**
     The dictionary of localized messages, for each of the languages that
     are going to be used. See http://formatjs.io/guides/message-syntax/ for
     more information on the message syntax.
     *
     For example, a valid dictionary would be:
     this.resources = {
      'en': { 'greeting': 'Hello!' }, 'fr' : { 'greeting': 'Bonjour!' }
     }
     */
    resources: {type: Object},

    /**
     Optional dictionary of user defined formats, as explained here:
     http://formatjs.io/guides/message-syntax/#custom-formats
     *
     For example, a valid dictionary of formats would be:
     this.formats = {
        number: { USD: { style: 'currency', currency: 'USD' } }
     }
     */
    formats: {
      type: Object,
      value: function() {
        return {
        }
      }
    },

    /**
     If true, will use the provided key when
     the translation does not exist for that key.
     */
    useKeyIfMissing: {type: Boolean, value: false},

    /**
     Translates a string to the current `language`. Any parameters to the
     string should be passed in order, as follows:
     `localize(stringKey, param1Name, param1Value, param2Name, param2Value)`
     */
    localize: {
      type: Function,
      computed: '__computeLocalize(language, resources, formats)'
    },

    /**
     If true, will bubble up the event to the parents
     */
    bubbleEvent: {type: Boolean, value: false},

    /**
     If true, credentials will be sent accross domains.
     */
    withCredentials: {type: Boolean, value: false}
  },

  loadResources: function(path, language, merge, withCredentials, headers) {
    var proto = this.constructor.prototype;
    if (merge === null || merge === undefined) {
      merge = true; //defaults to true
    }
    withCredentials = withCredentials || this.withCredentials;

    // Check if localCache exist just in case.
    this.__checkLocalizationCache(proto);

    // If the global ajax object has not been initialized, initialize and cache
    // it.
    var ajax = proto.__localizationCache.ajax;
    if (!ajax) {
      ajax = proto.__localizationCache.ajax =
          document.createElement('iron-ajax');
    }

    var request = proto.__localizationCache.requests[path];

    function onRequestResponse(event) {
      this.__onRequestResponse(event, language, merge);
    }

    if (!request) {
      ajax.url = path;
      ajax.withCredentials = !!withCredentials;
      if (headers instanceof Object) {
        ajax.headers = headers;
      }
      var request = ajax.generateRequest();

      request.completes.then(
          onRequestResponse.bind(this), this.__onRequestError.bind(this));

      // Cache the instance so that it can be reused if the same path is loaded.
      proto.__localizationCache.requests[path] = request;
    } else {
      request.completes.then(
          onRequestResponse.bind(this), this.__onRequestError.bind(this));
    }
  },

  /**
   Returns a computed `localize` method, based on the current `language`.
   */
  __computeLocalize: function(language, resources, formats) {
    var proto = this.constructor.prototype;

    // Check if localCache exist just in case.
    this.__checkLocalizationCache(proto);

    // Everytime any of the parameters change, invalidate the strings cache.
    if (!proto.__localizationCache) {
      proto['__localizationCache'] = {requests: {}, messages: {}, ajax: null};
    }
    proto.__localizationCache.messages = {};

    return function() {
      var key = arguments[0];
      if (!key || !resources || !language)
        return;
      const fallbackLanguage = language.split('-')[0];
      if (!resources[language])
        language = fallbackLanguage; // e.g. when using 'en-US' as language fallback to 'en' when 'en-US' resource is not available
      if (!resources[language])
        return;

      // Cache the key/value pairs for the same language, so that we don't
      // do extra work if we're just reusing strings across an application.
      var translatedValue = resources[language][key];

      // Use fallback language in case one language code (e.g. 'en') is used in combination with multiple country codes (e.g. 'en-us', 'en-gb')
      // Shared translations can be defined in the 'en' resource and specific translations in the 'en-us'/'en-gb' resource.
      if (!translatedValue && resources[fallbackLanguage]) 
        translatedValue = resources[fallbackLanguage][key];
      if (!translatedValue) {
        if (this.useKeyIfMissing) {
          translatedValue = key.toString();
          key = '#';
        } else {
          return '';
        }
      }

      var messageKey = key + translatedValue;
      var translatedMessage = proto.__localizationCache.messages[messageKey];

      if (!translatedMessage) {
        translatedMessage =
            new IntlMessageFormat(translatedValue, language, formats);
        proto.__localizationCache.messages[messageKey] = translatedMessage;
      }

      var args = {};
      for (var i = 1; i < arguments.length; i += 2) {
        args[arguments[i]] = arguments[i + 1];
      }

      return translatedMessage.format(args);
    }.bind(this);
  },

  __onRequestResponse: function(event, language, merge) {
    let newResources;

    if (language) {
      newResources = {};
      newResources[language] = event.response;
    } else {
      newResources = event.response;
    }

    if (merge && this.resources != undefined) {
      this.resources = _.merge({}, this.resources, newResources);
	  } else {
      this.resources = newResources;
	  }
    this.fire('app-localize-resources-loaded', event, {bubbles: this.bubbleEvent});
  },

  __onRequestError: function(event) {
    this.fire('app-localize-resources-error');
  },

  __checkLocalizationCache: function(proto) {
    // do nothing if proto is undefined.
    if (proto === undefined)
      return;

    // In the event proto not have __localizationCache object, create it.
    if (proto['__localizationCache'] === undefined) {
      proto['__localizationCache'] = {requests: {}, messages: {}, ajax: null};
    }
  }
};
