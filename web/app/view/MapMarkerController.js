/*
 * Copyright 2015 - 2016 Anton Tananaev (anton@traccar.org)
 * Copyright 2016 Andrey Kunitsyn (andrey@traccar.org)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

Ext.define('Traccar.view.MapMarkerController', {
    extend: 'Ext.app.ViewController',
    alias: 'controller.mapMarker',

    requires: [
        'Traccar.model.Position',
        'Traccar.model.Device',
        'Traccar.DeviceImages'
    ],

    config: {
        listen: {
            controller: {
                '*': {
                    selectdevice: 'selectDevice',
                    selectreport: 'selectReport'
                }
            },
            store: {
                '#Devices': {
                    add: 'updateDevice',
                    update: 'updateDevice',
                    remove: 'removeDevice'
                },
                '#LatestPositions': {
                    add: 'updateLatest',
                    update: 'updateLatest'
                },
                '#ReportRoute': {
                    add: 'addReportMarkers',
                    load: 'loadReport',
                    clear: 'clearReport'
                }
            },
            component: {
                '#': {
                    selectfeature: 'selectFeature',
                    deselectfeature: 'deselectFeature'
                }
            }
        }
    },

    init: function () {
        this.latestMarkers = {};
        this.reportMarkers = {};
        this.accuracyCircles = {};
        this.liveRoutes = {};
        this.liveRouteLength = Traccar.app.getAttributePreference('web.liveRouteLength', 10);
    },

    getAreaStyle: function (label, color) {
        var fillColor, strokeColor, styleConfig;
        if (color) {
            fillColor = ol.color.asArray(color);
            strokeColor = color;
        } else {
            fillColor = ol.color.asArray(Traccar.Style.mapGeofenceColor);
            strokeColor = Traccar.Style.mapGeofenceColor;
        }
        fillColor[3] = Traccar.Style.mapGeofenceOverlayOpacity;
        styleConfig = {
            fill: new ol.style.Fill({
                color: fillColor
            }),
            stroke: new ol.style.Stroke({
                color: strokeColor,
                width: Traccar.Style.mapGeofenceWidth
            })
        };
        if (label) {
            styleConfig.text = new ol.style.Text({
                text: label,
                fill: new ol.style.Fill({
                    color: Traccar.Style.mapGeofenceTextColor
                }),
                stroke: new ol.style.Stroke({
                    color: Traccar.Style.mapTextStrokeColor,
                    width: Traccar.Style.mapTextStrokeWidth
                }),
                font: Traccar.Style.mapTextFont
            });
        }
        return new ol.style.Style(styleConfig);
    },

    getDeviceColor: function (device) {
        switch (device.get('status')) {
            case 'online':
                return Traccar.Style.mapColorOnline;
            case 'offline':
                return Traccar.Style.mapColorOffline;
            default:
                return Traccar.Style.mapColorUnknown;
        }
    },

    updateDevice: function (store, data) {
        var i, device, deviceId, marker, style;

        if (!Ext.isArray(data)) {
            data = [data];
        }

        for (i = 0; i < data.length; i++) {
            device = data[i];
            deviceId = device.get('id');

            if (deviceId in this.latestMarkers) {
                marker = this.latestMarkers[deviceId];
                style = marker.getStyle();
                if (style.getImage().fill !== this.getDeviceColor(device) ||
                        style.getImage().category !== device.get('category')) {
                    this.updateDeviceMarker(style, this.getDeviceColor(device), device.get('category'));
                    marker.changed();
                }
                if (style.getText().getText() !== device.get('name')) {
                    style.getText().setText(device.get('name'));
                    marker.changed();
                }
            }
        }
    },

    removeDevice: function (store, data) {
        var i, deviceId;
        if (!Ext.isArray(data)) {
            data = [data];
        }
        for (i = 0; i < data.length; i++) {
            deviceId = data[i].get('id');
            if (this.latestMarkers[deviceId]) {
                this.getView().getMarkersSource().removeFeature(this.latestMarkers[deviceId]);
                delete this.latestMarkers[deviceId];
            }
            if (this.accuracyCircles[deviceId]) {
                this.getView().getAccuracySource().removeFeature(this.accuracyCircles[deviceId]);
                delete this.accuracyCircles[deviceId];
            }
            if (this.liveRoutes[deviceId]) {
                this.getView().getLiveRouteSource().removeFeature(this.liveRoutes[deviceId]);
                delete this.liveRoutes[deviceId];
            }
        }
    },

    updateLatest: function (store, data) {
        var i, position, device;

        if (!Ext.isArray(data)) {
            data = [data];
        }

        for (i = 0; i < data.length; i++) {
            position = data[i];
            device = Ext.getStore('Devices').getById(position.get('deviceId'));

            if (device) {
                this.updateAccuracy(position);
                this.updateLatestMarker(position, device);
                this.updateLiveRoute(position);
            }
        }
    },

    updateAccuracy: function (position) {
        var center, radius, feature, mapView, projection, pointResolution;
        mapView = this.getView().getMapView();
        feature = this.accuracyCircles[position.get('deviceId')];

        if (position.get('accuracy')) {
            projection = mapView.getProjection();
            center = ol.proj.fromLonLat([position.get('longitude'), position.get('latitude')]);
            pointResolution = ol.proj.getPointResolution(projection, mapView.getResolution(), center);
            radius = (position.get('accuracy') / ol.proj.METERS_PER_UNIT.m) * mapView.getResolution() / pointResolution;

            if (feature) {
                feature.getGeometry().setCenter(center);
                feature.getGeometry().setRadius(radius);
            } else {
                feature = new ol.Feature(new ol.geom.Circle(center, radius));
                feature.setStyle(this.getAreaStyle(null, Traccar.Style.mapAccuracyColor));
                this.getView().getAccuracySource().addFeature(feature);
                this.accuracyCircles[position.get('deviceId')] = feature;
            }
        } else {
            if (feature) {
                this.getView().getAccuracySource().removeFeature(feature);
            }
            delete this.accuracyCircles[position.get('deviceId')];
        }
    },

    updateLatestMarker: function (position, device) {
        var geometry, deviceId, marker, style;
        geometry = new ol.geom.Point(ol.proj.fromLonLat([
            position.get('longitude'),
            position.get('latitude')
        ]));
        deviceId = position.get('deviceId');
        if (deviceId in this.latestMarkers) {
            marker = this.latestMarkers[deviceId];
            style = marker.getStyle();
            if (style.getImage().angle !== position.get('course')) {
                this.rotateMarker(style, position.get('course'));
            }
            marker.setGeometry(geometry);
        } else {
            marker = new ol.Feature(geometry);
            marker.set('record', device);

            style = this.getLatestMarker(this.getDeviceColor(device),
                    position.get('course'),
                    device.get('category'));
            style.getText().setText(device.get('name'));
            marker.setStyle(style);
            this.latestMarkers[deviceId] = marker;
            this.getView().getMarkersSource().addFeature(marker);

        }

        if (marker === this.selectedMarker && this.lookupReference('deviceFollowButton').pressed) {
            this.getView().getMapView().setCenter(marker.getGeometry().getCoordinates());
        }
    },

    updateLiveRoute: function (position) {
        var deviceId, liveLine, liveCoordinates, lastLiveCoordinates, newCoordinates;
        deviceId = position.get('deviceId');
        if (deviceId in this.liveRoutes) {
            liveCoordinates = this.liveRoutes[deviceId].getGeometry().getCoordinates();
            lastLiveCoordinates = liveCoordinates[liveCoordinates.length - 1];
            newCoordinates = ol.proj.fromLonLat([position.get('longitude'), position.get('latitude')]);
            if (lastLiveCoordinates[0] === newCoordinates[0] &&
                    lastLiveCoordinates[1] === newCoordinates[1]) {
                return;
            }
            if (liveCoordinates.length >= this.liveRouteLength) {
                liveCoordinates.shift();
            }
            liveCoordinates.push(newCoordinates);
            this.liveRoutes[deviceId].getGeometry().setCoordinates(liveCoordinates);
        } else {
            liveLine = new ol.Feature({
                geometry: new ol.geom.LineString([
                    ol.proj.fromLonLat([
                        position.get('longitude'),
                        position.get('latitude')
                    ])
                ])
            });
            liveLine.setStyle(this.getRouteStyle(deviceId));
            this.liveRoutes[deviceId] = liveLine;
            this.getView().getLiveRouteSource().addFeature(liveLine);
        }
    },

    loadReport: function (store, data) {
        var i, position, point;

        this.addReportMarkers(store, data);

        this.reportRoute = [];
        for (i = 0; i < data.length; i++) {
            position = data[i];
            point = ol.proj.fromLonLat([
                position.get('longitude'),
                position.get('latitude')
            ]);
            if (i === 0 || data[i].get('deviceId') !== data[i - 1].get('deviceId')) {
                this.reportRoute.push(new ol.Feature({
                    geometry: new ol.geom.LineString([])
                }));
                this.reportRoute[this.reportRoute.length - 1].setStyle(this.getRouteStyle(data[i].get('deviceId')));
                this.getView().getRouteSource().addFeature(this.reportRoute[this.reportRoute.length - 1]);
            }
            this.reportRoute[this.reportRoute.length - 1].getGeometry().appendCoordinate(point);
        }
    },

    addReportMarker: function (position) {
        var geometry, marker, style, point = ol.proj.fromLonLat([
            position.get('longitude'),
            position.get('latitude')
        ]);
        geometry = new ol.geom.Point(point);
        marker = new ol.Feature(geometry);
        marker.set('record', position);
        style = this.getReportMarker(position.get('deviceId'), position.get('course'));
        marker.setStyle(style);
        this.reportMarkers[position.get('id')] = marker;
        this.getView().getMarkersSource().addFeature(marker);
    },

    addReportMarkers: function (store, data) {
        var i, position, point, minx, miny, maxx, maxy;
        this.clearReport();
        for (i = 0; i < data.length; i++) {
            position = data[i];
            point = ol.proj.fromLonLat([
                position.get('longitude'),
                position.get('latitude')
            ]);
            if (i === 0) {
                minx = maxx = point[0];
                miny = maxy = point[1];
            } else {
                minx = Math.min(point[0], minx);
                miny = Math.min(point[1], miny);
                maxx = Math.max(point[0], maxx);
                maxy = Math.max(point[1], maxy);
            }
            if (store.showMarkers) {
                this.addReportMarker(position);
            }
        }
        if (minx !== maxx || miny !== maxy) {
            this.getView().getMapView().fit([minx, miny, maxx, maxy]);
        } else if (point) {
            this.getView().getMapView().fit(new ol.geom.Point(point));
        }
    },

    clearReport: function () {
        var key, i;

        if (this.reportRoute) {
            for (i = 0; i < this.reportRoute.length; i++) {
                this.getView().getRouteSource().removeFeature(this.reportRoute[i]);
            }
            this.reportRoute = null;
        }

        if (this.reportMarkers) {
            for (key in this.reportMarkers) {
                if (this.reportMarkers.hasOwnProperty(key)) {
                    this.getView().getMarkersSource().removeFeature(this.reportMarkers[key]);
                }
            }
            this.reportMarkers = {};
        }

        if (this.selectedMarker && this.selectedMarker.get('record') instanceof Traccar.model.Position) {
            this.selectedMarker = null;
        }
    },

    getRouteStyle: function (deviceId) {
        return new ol.style.Style({
            stroke: new ol.style.Stroke({
                color: Traccar.app.getReportColor(deviceId),
                width: Traccar.Style.mapRouteWidth
            })
        });
    },

    getMarkerStyle: function (zoom, color, angle, category) {
        var image = Traccar.DeviceImages.getImageIcon(color, zoom, angle, category);
        return new ol.style.Style({
            image: image,
            text: new ol.style.Text({
                textBaseline: 'bottom',
                fill: new ol.style.Fill({
                    color: Traccar.Style.mapTextColor
                }),
                stroke: new ol.style.Stroke({
                    color: Traccar.Style.mapTextStrokeColor,
                    width: Traccar.Style.mapTextStrokeWidth
                }),
                offsetY: -image.getSize()[1] / 2 - Traccar.Style.mapTextOffset,
                font : Traccar.Style.mapTextFont
            })
        });
    },

    getLatestMarker: function (color, angle, category) {
        return this.getMarkerStyle(false, color, angle, category);
    },

    getReportMarker: function (deviceId, angle) {
        return this.getMarkerStyle(false, Traccar.app.getReportColor(deviceId), angle, 'arrow');
    },

    resizeMarker: function (style, zoom) {
        var image, text;
        image = Traccar.DeviceImages.getImageIcon(style.getImage().fill,
                zoom,
                style.getImage().angle,
                style.getImage().category);
        text = style.getText();
        text.setOffsetY(-image.getSize()[1] / 2 - Traccar.Style.mapTextOffset);
        style.setText(text);
        style.setImage(image);
    },

    rotateMarker: function (style, angle) {
        style.setImage(Traccar.DeviceImages.getImageIcon(style.getImage().fill,
                style.getImage().zoom,
                angle,
                style.getImage().category));
    },

    updateDeviceMarker: function (style, color, category) {
        var image, text;
        image = Traccar.DeviceImages.getImageIcon(color,
                style.getImage().zoom,
                style.getImage().angle,
                category);
        text = style.getText();
        text.setOffsetY(-image.getSize()[1] / 2 - Traccar.Style.mapTextOffset);
        style.setText(text);
        style.setImage(image);
    },

    selectMarker: function (marker, center) {
        if (this.selectedMarker) {
            if (!Ext.getStore('ReportRoute').showMarkers &&
                    this.selectedMarker.get('record') instanceof Traccar.model.Position) {
                this.getView().getMarkersSource().removeFeature(this.selectedMarker);
                delete this.reportMarkers[this.selectedMarker.get('record').get('id')];
            } else {
                this.resizeMarker(this.selectedMarker.getStyle(), false);
                this.selectedMarker.getStyle().setZIndex(0);
                this.selectedMarker.changed();
            }
        }

        if (marker) {
            this.resizeMarker(marker.getStyle(), true);
            marker.getStyle().setZIndex(1);
            marker.changed();
            if (center) {
                this.getView().getMapView().setCenter(marker.getGeometry().getCoordinates());
            }
        }

        this.selectedMarker = marker;
    },

    selectDevice: function (device, center) {
        this.selectMarker(this.latestMarkers[device.get('id')], center);
    },

    selectReport: function (position, center) {
        if (position instanceof Traccar.model.Position) {
            if (!Ext.getStore('ReportRoute').showMarkers) {
                this.addReportMarker(position);
            }
            this.selectMarker(this.reportMarkers[position.get('id')], center);
        }
    },

    selectFeature: function (feature) {
        var record = feature.get('record');
        if (record) {
            if (record instanceof Traccar.model.Device) {
                this.fireEvent('selectdevice', record, false);
            } else {
                this.fireEvent('selectreport', record, false);
            }
        }
    },

    deselectFeature: function () {
        this.selectMarker(null, false);
        this.fireEvent('deselectfeature');
    }
});
