import moment from 'moment';
import { uiModules } from 'ui/modules';
import uiRoutes from 'ui/routes';
import template from './templates/index.html';
import React from 'react';
import ReactDOM from 'react-dom';
import MyTable from './components/mytable.js';
import MyMapping from './components/mymapping.js';

import 'ui/autoload/styles';
import './less/main.less';
import 'fixed-data-table-2/dist/fixed-data-table.min.css';
import 'angular-spinner';
import 'angular-translate';
import 'angular-translate-loader-static-files';


let jsonData;                               // Contient les données de conversion du xlxs 

const maxFileSize = 4;                      // Taille du fichier xlxs avant warning 
const bulkSize = 3000;                      // Taille maximal des paquets du bulk 
const maxDisplayableElement = 5;            // Nombre d'element afficher dans la previs des données
var supportedFileType = ['xlsx', 'csv'];  // Defini les extensions utilisable dans le plugin

var app = uiModules.get('app/xlsx_import', ['angularSpinner', 'pascalprecht.translate']);

uiRoutes.enable();
uiRoutes
.when('/', {
  template : template
});


app.config(['$translateProvider', function($translateProvider){
  //angular-translate security
  $translateProvider.useSanitizeValueStrategy('escape');

  //Path for loading translation files [prefix][filename][suffix]
  $translateProvider.useStaticFilesLoader({
    prefix: '../plugins/xlsx-import/i18n/',
    suffix: '.json'
  });

  // Tell the module what language to use by default
  var userLang = navigator.language || navigator.userLanguage;
  if(userLang === 'fr')
    $translateProvider.preferredLanguage('fr');
  else
    $translateProvider.preferredLanguage('en');

}])

app.config(['usSpinnerConfigProvider', function (usSpinnerConfigProvider) {
  usSpinnerConfigProvider.setDefaults({color: 'black'});
}])


app.controller('xlsxImport', function ($scope, $route, $interval, $http, $translate) {
  $scope.title = 'XLSX Import';
  $scope.description = 'Import XLSX to JSON';
  $scope.showUploadOptions = false;
  $scope.indexName = '';
  $scope.showSpinner = false;


  $scope.changeLanguage = function (langKey) {
    $translate.use(langKey).then(function(){}, function(){toastr.error('JSON file is invalid')})
  };


  $scope.mappingCheckChange = function(){

    if($scope.mappingCheck) {
      ReactDOM.render(
        <MyMapping data={jsonData} />,
        document.getElementById("mapping")
      );
    } else {
        document.getElementById("mapping").innerHTML = '';
    }
  }


  $scope.transfer = function() {

    var promises = [];
    var bulk_request = [];

    $scope.indexName = angular.element('#indexName').val();
    $scope.showSpinner = true;    //On affiche le spinner


    if($scope.mappingCheck){    //Si l'utilisateur souhaite choisir son propre mapping

      $http.get('../api/xlsx_import/' + $scope.indexName + '/_exists')    //On verifie si l'index existe déjà
        .then((response) => {
          console.log(response);
          if(response.data.status != 404) {   //Si l'index existe déjà, on envoi un message et on annule le push
            alert($translate.instant('INDEX_ALREADY_EXIST_MESSAGE'));
            $scope.showSpinner = false;
            return;
          }
          else {

            var mapping_request = createMappingJson();

            $http.post('../api/xlsx_import/'+ $scope.indexName)  //On crée l'index dans ES
              .then((response) => {
                console.log(response);

                $http.post('../api/xlsx_import/'+ $scope.indexName +'/_mapping/doc', mapping_request)  //On attribut le mapping dynamique
                  .then((response) => {
                    console.log(response);

                    bulk_request = createBulk($scope.indexName);

                    bulk_request.forEach(function(split_bulk){

                    $http.post('../api/xlsx_import/'+ $scope.indexName +'/doc/_bulk', split_bulk)   //On push les data avec le bulk
                      .then((response) => {
                        console.log(response);
                        promises.push(Promise.resolve(response));
                      }).then(function(){
                        if(promises.length === bulk_request.length) {   //On check si toutes les promesses sont dans le tableau
                          $scope.showSpinner = false                    //On arrete le spinner
                          Promise.all(promises).then(function(){        //On verifie si toutes les promesses sont correctes et on envoi un msg
                            alert($translate.instant('SUCCESS_TRANSFER_MESSAGE') + ' ('+jsonData.data.length+' elements)');
                          }).catch(reason => {
                            alert($translate.instant('FAILED_TRANSFER_MESSAGE'));
                          });
                        }
                      });
                    })
                  });
              });

          }
        });
    }
    else {    //Si l'utilisateur ne souhaite pas de mapping perso, on push juste les données

      bulk_request = createBulk($scope.indexName);

      bulk_request.forEach(function(split_bulk){

        $http.post('../api/xlsx_import/'+ $scope.indexName +'/doc/_bulk', split_bulk)
          .then((response) => {
            console.log(response);
            promises.push(Promise.resolve(response));
        }).then(function(){
            if(promises.length === bulk_request.length) {   //On check si toutes les promesses sont dans le tableau
              $scope.showSpinner = false                    //On arrete le spinner
              Promise.all(promises).then(function(){        //On verifie si toutes les promesses sont correctes et on envoi un msg
                alert($translate.instant('SUCCESS_TRANSFER_MESSAGE') + ' ('+jsonData.data.length+' elements)');
              }).catch(reason => {
                alert($translate.instant('FAILED_TRANSFER_MESSAGE'));
              });
            }
        });
      })
    }
  }

});


app.directive('importSheetJs', function($translate) {
  return {
    scope: { opts: '=' },
    link: function ($scope, $elm, $attrs) {

      $elm.on('change', function (changeEvent) {
        var reader = new FileReader();

        if (!supportedFileType.includes(getExtension(changeEvent.target.files[0].name)[0])) {
          alert($translate.instant("INVALID_EXTENSION_FILE_MESSAGE"));
          return
        }

        try {
          reader.onload = function (file) {
            if (typeof FileReader !== "undefined") {

              var size = (changeEvent.target.files[0].size)/1000000;
              var message = $translate.instant('SIZE_WARNING_MESSAGE');

              //Warning si file.size > maxFileSize (TBD)
              if(size > maxFileSize) {

                if(confirm(message)) {
                  convert_data(reader, function(){
                    document.getElementById("import_form").innerHTML = 
                      '<button type="button" onclick="location.reload();">'+ $translate.instant('REFRESH_BUTTON') +'</button>';
                    $scope.$parent.showSpinner = false;
                    $scope.$parent.$apply();
                  });
                  display_data($translate.instant('DISPLAY_LIMIT_MESSAGE'));
                }
                else {
                  //On enleve l'affichage des champs et du spinner si la conversion est annulée
                  $scope.$parent.showSpinner = false;
                  $scope.$parent.showUploadOptions = false;
                  $scope.$parent.$apply();
                  return;
                }

              }
              else {
                convert_data(reader, function(){
                  document.getElementById("import_form").innerHTML = 
                    '<p><button type="button" onclick="location.reload();">'+ $translate.instant('REFRESH_BUTTON') +'</button></p>';
                  $scope.$parent.showSpinner = false;
                  $scope.$parent.$apply();
                });
                display_data("");
              }
            }
          }; 
          reader.readAsBinaryString(changeEvent.target.files[0]);

          $scope.$parent.showSpinner = true;                                            //On affiche le spinner
          $scope.$parent.showUploadOptions = true;                                      //On rend le champ index editable
          $scope.$parent.indexName = setESIndexName(changeEvent.target.files[0].name);  //On lui donne la valeur par defaut formaté                                            //On affiche le bouton de transfert
          $scope.$parent.$apply();

        } catch(err) {
          alert($translate.instant("INVALID_EXTENSION_FILE_MESSAGE"));
          return
        }
      });
    }
  };
});



//Traitement du fichier XLSX -> JSON
function convert_data(reader, callback) {
  var fileData = reader.result;

  var wb = XLSX.read(fileData, {type : 'binary'});
  jsonData = new Object();

  /*wb.SheetNames.forEach(function(sheetName){
    update_sheet_range(wb.Sheets[sheetName]);
    jsonData.header = get_header_row(wb.Sheets[sheetName]);
    jsonData.data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
  })*/

  update_sheet_range(wb.Sheets[wb.SheetNames[0]]);
  jsonData.header = get_header_row(wb.Sheets[wb.SheetNames[0]]);
  jsonData.data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  if (typeof callback === "function")
    callback();
}

//Affichage des données dans une table html après conversion
function display_data(message) {
    var headers = '';
    var body = '';

      if(message)
      document.getElementById("message").innerHTML = '<pre style="background-color:rgba(255, 0, 0, 0.4);">' + message + '</pre>';

    ReactDOM.render(
      <MyTable data={jsonData} maxElement={maxDisplayableElement}/>,
      document.getElementById("react_preview")
    ); 

}

//Mise à jour du fichier en cas d'ouverture avec d'autres logiciel... (libreoffice)
function update_sheet_range(ws) {
  var range = {s:{r:20000000, c:20000000},e:{r:0,c:0}};
  Object.keys(ws).filter(function(x) { return x.charAt(0) != "!"; }).map(XLSX.utils.decode_cell).forEach(function(x) {
    range.s.c = Math.min(range.s.c, x.c); range.s.r = Math.min(range.s.r, x.r);
    range.e.c = Math.max(range.e.c, x.c); range.e.r = Math.max(range.e.r, x.r);
  });
  ws['!ref'] = XLSX.utils.encode_range(range);
}

//Recupère le header de la feuille excel
function get_header_row(sheet) {
    var headers = [];
    var range = XLSX.utils.decode_range(sheet['!ref']);
    var C, R = range.s.r; /* start in the first row */
    /* walk every column in the range */
    for(C = range.s.c; C <= range.e.c; ++C) {
        var cell = sheet[XLSX.utils.encode_cell({c:C, r:R})] /* find the cell in the first row */

        var hdr = "UNKNOWN " + C; // <-- replace with your desired default 
        if(cell && cell.t) hdr = XLSX.utils.format_cell(cell);

        headers.push(hdr);
    }
    return headers;
}

//Formate le nom du fichier pour le transformer en nom d'index ES correct
function setESIndexName(name) {
  
  var name = name.split('.')[0];                //on enlève l'extension du fichier
  var name = name.replace(/[^a-zA-Z ]/g, "");   //on enlève aussi les charactères speciaux (modif possible avec UTF?)
  return name;
}

//Retourne l'extension d'un fichier
function getExtension(filename) {
  return (/[.]/.exec(filename)) ? /[^.]+$/.exec(filename) : undefined;
}

//Crée les données JSON pour le mapping dynamique
function createMappingJson() {
  var mapping_request = '{ "properties": {';
  console.log(jsonData.header);
  for(var i = 0; i < jsonData.header.length; i++) {
    if(i < jsonData.header.length -1)
      mapping_request += '"'+ jsonData.header[i] +'": { "type": "'+ angular.element('#' + jsonData.header[i]).val() +'" }, ';
    else
      mapping_request += '"'+ jsonData.header[i] +'": { "type": "'+ angular.element('#' + jsonData.header[i]).val() +'" }';
    }
    mapping_request += '} }';

    return mapping_request;
}

//Crée les données JSON pour le bulk
function createBulk(indexName) {
  var bulk_request = [];
  var bulk_package = [];

  for(var i = 0; i < jsonData.data.length; i++) {
    bulk_package.push({index: { _index: indexName, _type: 'doc' } });
    bulk_package.push(jsonData.data[i]);

    if(bulk_package.length >= bulkSize) {
      bulk_request.push(bulk_package);
      bulk_package = [];
    }
  }
  bulk_request.push(bulk_package);

  return bulk_request;
}
